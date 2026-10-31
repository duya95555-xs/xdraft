#!/usr/bin/env python3
from __future__ import annotations

"""Parse Axure RP (.rp) files and generate Markdown documents.

Supports:
  - Axure RP 9  (XML-based data in document_data/)
  - Axure RP 10+ (JSON-based data in data/)

Usage:
  python3 axure_parser.py <input.rp> [--output <dir>] [--images-dir <dir>]
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path
from typing import Optional, Union


def extract_zip(rp_path: str, dest_dir: str) -> None:
    """Extract the .rp ZIP archive to dest_dir."""
    with zipfile.ZipFile(rp_path, "r") as zf:
        zf.extractall(dest_dir)


def detect_format(extract_dir: str) -> str:
    """Detect Axure version: 'rp9' (XML) or 'rp10' (JSON)."""
    # RP10: data/ directory exists
    if os.path.isdir(os.path.join(extract_dir, "data")):
        return "rp10"
    # RP9: document_data/ directory exists
    if os.path.isdir(os.path.join(extract_dir, "document_data")):
        return "rp9"
    # Fallback: try to detect by finding JSON or XML files
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if f.endswith(".json"):
                return "rp10"
            if f.endswith(".xml"):
                return "rp9"
    raise ValueError("Unknown Axure RP format: no data/document_data directory found")


# ---------------------------------------------------------------------------
# RP9 (XML) parser
# ---------------------------------------------------------------------------

def parse_rp9(extract_dir: str, images_dir: str) -> list[dict]:
    """Parse Axure RP 9 project and return list of page dicts.

    Each page dict: {title, widgets: [{type, text, x, y, w, h, image}]}
    """
    data_dir = os.path.join(extract_dir, "document_data", "data")
    pages = []

    # Find page files
    pages_dir = os.path.join(data_dir, "pages")
    if not os.path.isdir(pages_dir):
        # Pages might be inline in document XML
        doc_xml = os.path.join(data_dir, "document.xml")
        if os.path.isfile(doc_xml):
            pages = _parse_rp9_xml_pages(doc_xml, data_dir, images_dir)
            return pages
        return []

    for fname in sorted(os.listdir(pages_dir)):
        if not fname.endswith(".xml"):
            continue
        fpath = os.path.join(pages_dir, fname)
        page = _parse_rp9_page_xml(fpath, data_dir, images_dir)
        if page:
            pages.append(page)
    return pages


def _parse_rp9_page_xml(fpath: str, data_dir: str, images_dir: str) -> Optional[dict]:
    """Parse a single RP9 page XML file."""
    try:
        tree = ET.parse(fpath)
        root = tree.getroot()
    except ET.ParseError:
        return None

    # Page title: try <page> name attr, or <title> element, or filename
    page_name = root.get("name", "")
    if not page_name:
        title_el = root.find(".//title")
        if title_el is not None and title_el.text:
            page_name = title_el.text
    if not page_name:
        page_name = os.path.splitext(os.path.basename(fpath))[0]

    widgets = []
    _collect_rp9_widgets(root, data_dir, images_dir, widgets)
    return {"title": page_name.strip(), "widgets": widgets}


def _collect_rp9_widgets(
    element: ET.Element, data_dir: str, images_dir: str, widgets: list
) -> None:
    """Recursively collect widgets from RP9 XML elements."""
    tag = element.tag.lower()
    if tag in ("widget", "element"):
        wtype = element.get("type", element.get("widgettype", "unknown"))
        label = element.get("label", "")
        text = element.get("text", "")
        # Try child text elements
        if not text:
            for child in element:
                if child.tag.lower() in ("text", "label", "caption"):
                    text = child.text or ""
                    break
        # Also check inner text
        if not text and element.text and element.text.strip():
            text = element.text.strip()

        content = text or label or ""
        content = _clean_text(content)

        x = float(element.get("x", "0") or "0")
        y = float(element.get("y", "0") or "0")
        w = float(element.get("w", element.get("width", "0")) or "0")
        h = float(element.get("h", element.get("height", "0")) or "0")

        widget = {"type": wtype, "text": content, "x": x, "y": y, "w": w, "h": h}

        # Check for image references
        image = _find_rp9_image(element, data_dir, images_dir)
        if image:
            widget["image"] = image

        if content or image:
            widgets.append(widget)

    for child in element:
        _collect_rp9_widgets(child, data_dir, images_dir, widgets)


def _find_rp9_image(
    element: ET.Element, data_dir: str, images_dir: str
) -> Optional[str]:
    """Find an image reference in an RP9 widget and copy to images_dir."""
    # Check for image child elements or attributes
    for child in element:
        if child.tag.lower() in ("image", "img", "picture"):
            src = child.get("src", child.get("source", ""))
            if src:
                return _copy_image(src, data_dir, images_dir)
        # Check style background-image
        style = child.get("style", "")
        match = re.search(r"url\(['\"]?([^)'\"]+)", style)
        if match:
            return _copy_image(match.group(1), data_dir, images_dir)

    # Check widget's own image attributes
    for attr in ("src", "image", "imagesource"):
        val = element.get(attr, "")
        if val:
            return _copy_image(val, data_dir, images_dir)

    return None


def _parse_rp9_xml_pages(doc_xml: str, data_dir: str, images_dir: str) -> list[dict]:
    """Parse pages from inline RP9 document XML."""
    try:
        tree = ET.parse(doc_xml)
        root = tree.getroot()
    except ET.ParseError:
        return []

    pages = []
    for page_el in root.iter("page"):
        name = page_el.get("name", "Untitled")
        widgets = []
        _collect_rp9_widgets(page_el, data_dir, images_dir, widgets)
        pages.append({"title": name.strip(), "widgets": widgets})
    return pages


# ---------------------------------------------------------------------------
# RP10 (JSON) parser
# ---------------------------------------------------------------------------

def parse_rp10(extract_dir: str, images_dir: str) -> list[dict]:
    """Parse Axure RP 10 project and return list of page dicts."""
    data_dir = os.path.join(extract_dir, "data")
    pages = []

    # Try pages/ directory first
    pages_dir = os.path.join(data_dir, "pages")
    if os.path.isdir(pages_dir):
        for fname in sorted(os.listdir(pages_dir)):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(pages_dir, fname)
            page = _parse_rp10_page_json(fpath, data_dir, images_dir)
            if page:
                pages.append(page)
        if pages:
            return pages

    # Try document.json which may contain all pages inline
    doc_json = os.path.join(data_dir, "document.json")
    if os.path.isfile(doc_json):
        with open(doc_json, "r", encoding="utf-8") as f:
            doc = json.load(f)
        if isinstance(doc, dict):
            doc_pages = doc.get("pages", doc.get("pagesData", []))
            if isinstance(doc_pages, list):
                for pdata in doc_pages:
                    if isinstance(pdata, dict):
                        title = pdata.get("name", pdata.get("title", "Untitled"))
                        widgets = []
                        _collect_rp10_widgets(pdata, data_dir, images_dir, widgets)
                        pages.append({"title": title, "widgets": widgets})

    return pages


def _parse_rp10_page_json(fpath: str, data_dir: str, images_dir: str) -> Optional[dict]:
    """Parse a single RP10 page JSON file."""
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return None

    title = data.get("name", data.get("title", ""))
    if not title:
        title = os.path.splitext(os.path.basename(fpath))[0]

    widgets = []
    _collect_rp10_widgets(data, data_dir, images_dir, widgets)
    return {"title": title.strip(), "widgets": widgets}


def _collect_rp10_widgets(
    obj: Union[dict, list], data_dir: str, images_dir: str, widgets: list
) -> None:
    """Recursively collect widgets from RP10 JSON data."""
    if isinstance(obj, list):
        for item in obj:
            _collect_rp10_widgets(item, data_dir, images_dir, widgets)
        return

    if not isinstance(obj, dict):
        return

    # Check if this is a widget node
    wtype = obj.get("type", obj.get("widgetType", ""))
    if wtype:
        text = obj.get("text", obj.get("label", ""))
        if isinstance(text, (list, dict)):
            text = json.dumps(text, ensure_ascii=False)
        text = _clean_text(str(text)) if text else ""

        x = float(obj.get("x", 0) or 0)
        y = float(obj.get("y", 0) or 0)
        w = float(obj.get("width", obj.get("w", 0)) or 0)
        h = float(obj.get("height", obj.get("h", 0)) or 0)

        widget = {"type": wtype, "text": text, "x": x, "y": y, "w": w, "h": h}

        # Check for image sources
        image = _find_rp10_image(obj, data_dir, images_dir)
        if image:
            widget["image"] = image

        if text or image:
            widgets.append(widget)

    # Recurse into children
    for key in ("children", "widgets", "elements", "items"):
        val = obj.get(key)
        if val:
            _collect_rp10_widgets(val, data_dir, images_dir, widgets)


def _find_rp10_image(
    obj: dict, data_dir: str, images_dir: str
) -> Optional[str]:
    """Find an image reference in an RP10 widget and copy to images_dir."""
    # Direct image properties
    for key in ("imageSrc", "imageSource", "src", "source"):
        val = obj.get(key, "")
        if val and isinstance(val, str):
            return _copy_image(val, data_dir, images_dir)

    # Style-based background image
    style = obj.get("style", {})
    if isinstance(style, dict):
        bg = style.get("backgroundImage", style.get("background-image", ""))
        if bg and isinstance(bg, str):
            match = re.search(r"url\(['\"]?([^)'\"]+)", bg)
            if match:
                return _copy_image(match.group(1), data_dir, images_dir)

    return None


# ---------------------------------------------------------------------------
# RP9 binary/gzip fallback parser
# ---------------------------------------------------------------------------

_BINARY_SKIP_PREFIXES = (
    "Axure:",
    "MyStyle",
    "Typeface",
    "Arial",
    "'Arial",
    "HackLegacy",
    "Adaptive",
    "AnnLink",
    "BaseStyle",
    "Capabilities",
    "Color",
    "ControlPoints",
    "Data",
    "Default",
    "Description",
    "Diagram",
    "Disabled",
    "Family",
    "GroupsClean",
    "Hash",
    "Height",
    "HideHintOnFocus",
    "Hint",
    "Horizontal",
    "Id",
    "Info",
    "Interaction",
    "Is",
    "Legacy",
    "Library",
    "LineSpacing",
    "ListInfo",
    "Loaded",
    "LowerHandle",
    "Major",
    "MatchInfo",
    "MaxLength",
    "Minor",
    "MyPageStyle",
    "Normal",
    "Offset",
    "Package",
    "PageStyle",
    "Paragraphs",
    "PlaceholderText",
    "Prop",
    "ReadOnly",
    "Revision",
    "RichText",
    "Selected",
    "Shape",
    "Size",
    "Start",
    "Strikethrough",
    "Style",
    "SubmitButton",
    "Target",
    "Text",
    "Type",
    "Underline",
    "Value",
    "Version",
    "Vertical",
    "Visible",
    "Weight",
    "Width",
    "WordWrap",
    "attributed-",
    "diagram-",
    "fill-",
    "fit-",
    "horizontal-",
    "is-",
    "keep-",
    "name-block",
    "node-",
    "page-style",
    "panel-",
    "parent-",
    "plain-",
    "property-",
    "reference-",
    "rich-",
    "ruler-",
    "scrollbars",
    "text-",
    "vertical-",
)

_BINARY_SKIP_EXACT = {
    "*type",
    "All",
    "Arrow",
    "Black",
    "Black Oblique",
    "Bold Oblique",
    "Box 1",
    "Box 2",
    "Box 3",
    "Build",
    "Button",
    "Checkbox",
    "ColorBrightness",
    "ColorContrast",
    "ColorSaturation",
    "Cursiva",
    "Droplist",
    "Droplists",
    "Ellipse",
    "End",
    "Flow",
    "Flow Shape",
    "Form Disabled",
    "Form Hint",
    "HigherHandle",
    "HigherSegmentExists",
    "Icon",
    "Image",
    "Inlines",
    "Label",
    "Line",
    "Link Button",
    "List Box",
    "List Boxes",
    "Menu Item",
    "Name",
    "Narrow",
    "Narrow Bold",
    "Narrow Bold Italic",
    "Narrow Bold Oblique",
    "Narrow Italic",
    "Narrow Oblique",
    "Negreta",
    "Negreta cursiva",
    "Oblique",
    "Paragraph",
    "Path",
    "Placeholder",
    "Primary Button",
    "Radio Button",
    "Rollover State",
    "Rollovers",
    "Shape",
    "Snapshot",
    "Sticky 1",
    "Sticky 2",
    "Sticky 3",
    "Sticky 4",
    "String",
    "Table",
    "Table Cell",
    "Text Area",
    "Text Field",
    "Tree Node",
    "True",
    "False",
    "columns",
    "initialized",
    "list-options",
    "multiple",
    "object",
    "row-heights",
    "rows",
    "selected",
    "solid",
    "tree",
    "一级标题",
    "二级标题",
    "三级标题",
    "四级标题",
    "五级标题",
    "六级标题",
    "文本段落",
    "表单提示",
    "表单禁用",
    "流程形状",
    "线段",
    "连接",
    "形状",
    "文本框",
    "图片",
    "默认样式",
    "右上_数据栏",
    "表",
}

_BINARY_DESIGN_SKIP_EXACT = _BINARY_SKIP_EXACT | {
    "HTML 1",
    "Word Doc 1",
    "CSV Report 1",
    "Print 1",
    "IaxureRP8扩展元件库V1.2版",
    "蚂蚁金服后台_Web标准包",
    "文本链接",
    "鼠标悬停文本链接",
    "鼠标按下文本链接",
    "安卓移动元件库",
    "常用元件库",
    "微软雅黑",
    "Axure低保真组件库",
    "SVG矢量图标元件库",
    "说明",
    "页面概述",
}


def parse_rp_binary(rp_path: str, images_dir: str) -> list[dict]:
    """Parse non-ZIP RP9 files that store Axure objects as gzip members.

    Some RP9 files are not ZIP archives. Their readable object data is stored
    in gzip-compressed binary serialization blocks. This fallback extracts
    length-prefixed UTF-8 strings and groups them into design-info pages.
    """
    del images_dir  # Images are not directly recoverable by this fallback.

    data = Path(rp_path).read_bytes()
    blocks = []

    for idx, offset in enumerate(_find_gzip_offsets(data)):
        payload = _decompress_gzip_member(data[offset:])
        if not payload:
            continue

        strings = _extract_length_prefixed_strings(payload)
        kind = next((s for _, s in strings if s.startswith("Axure:")), "")
        if not _is_binary_design_block(kind):
            continue

        contents = _filter_binary_design_strings(strings, kind)
        if not contents:
            continue

        title = _infer_binary_block_title(kind, contents)
        if not title:
            title = f"{kind.replace('Axure:', '') or 'Block'} {idx + 1}"

        blocks.append({"title": title, "kind": kind, "contents": contents})

    return _merge_binary_blocks(blocks)


def _find_gzip_offsets(data: bytes) -> list[int]:
    offsets = []
    start = 0
    magic = b"\x1f\x8b\x08"
    while True:
        offset = data.find(magic, start)
        if offset < 0:
            return offsets
        offsets.append(offset)
        start = offset + 1


def _decompress_gzip_member(data: bytes) -> bytes:
    try:
        decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        return decompressor.decompress(data)
    except zlib.error:
        return b""


def _extract_length_prefixed_strings(data: bytes) -> list[tuple[int, str]]:
    strings = []
    for offset in range(0, max(0, len(data) - 4)):
        length = struct.unpack_from("<I", data, offset)[0]
        if length < 1 or length > 500:
            continue
        end = offset + 4 + length
        if end > len(data):
            continue
        raw = data[offset + 4:end]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if not _looks_like_text(text):
            continue
        strings.append((offset, _clean_binary_text(text)))
    return strings


def _looks_like_text(text: str) -> bool:
    if not text:
        return False
    if any(ord(ch) < 32 and ch not in "\r\n\t" for ch in text):
        return False
    return any("\u4e00" <= ch <= "\u9fff" or ch.isalnum() for ch in text)


def _clean_binary_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _is_binary_design_block(kind: str) -> bool:
    return kind in {
        "Axure:DesignDocument",
        "Axure:Page",
        "Axure:PanelState",
        "Axure:Master",
    }


def _filter_binary_design_strings(
    strings: list[tuple[int, str]], kind: str
) -> list[str]:
    contents = []
    seen = set()
    skip_exact = (
        _BINARY_DESIGN_SKIP_EXACT
        if kind == "Axure:DesignDocument"
        else _BINARY_SKIP_EXACT
    )

    for _, text in strings:
        if _is_binary_content_string(text, skip_exact) and text not in seen:
            contents.append(text)
            seen.add(text)

    return contents


def _is_binary_content_string(text: str, skip_exact: set[str]) -> bool:
    text = text.strip()
    if not text or text in skip_exact:
        return False
    if re.fullmatch(r"\d+", text):
        return False
    if re.fullmatch(r"[0-9a-fA-F]{16,}", text):
        return False
    if re.fullmatch(r"[0-9a-fA-F-]{30,}", text):
        return False
    if text.endswith(".Name"):
        return False
    if any(text.startswith(prefix) for prefix in _BINARY_SKIP_PREFIXES):
        return False

    has_cjk = any("\u4e00" <= ch <= "\u9fff" for ch in text)
    if has_cjk:
        return True

    if re.fullmatch(r"(MSA|SPL ?\d|SPL\d|AVE|%?[A-Za-z&]+)", text):
        return text in {"MSA", "AVE"} or text.startswith("SPL")
    if text.endswith(".html"):
        return True
    if "%" in text or "&" in text:
        return True

    return False


def _infer_binary_block_title(kind: str, contents: list[str]) -> str:
    content_set = set(contents)
    joined = "\n".join(contents)

    if kind == "Axure:DesignDocument":
        return "项目结构"

    if "一、数据填写--偏倚" in content_set:
        return "填写报告-偏倚"
    if "一、数据填写--线性" in content_set:
        return "填写报告-线性"
    if "一、数据填写--稳定性" in content_set:
        return "填写报告-稳定性"
    if "一、数据填写--GR&R" in content_set:
        return "填写报告-GR&R"

    if "测量报告--偏倚" in content_set:
        return "查看报告-偏倚"
    if "测量报告--线性" in content_set:
        return "查看报告-线性"
    if "测量报告--稳定性" in content_set:
        return "查看报告-稳定性"
    if "测量报告--GR&R" in content_set:
        return "查看报告-GR&R"

    if "人员资质-新增.html" in content_set:
        return "MSA人员资质"
    if "MSA计划-新增.html" in content_set:
        return "校准项目"
    if "MSA人员资质" in content_set:
        return "MSA人员资质"
    if "MSA计划" in content_set:
        return "MSA计划"
    if "校准项目" in content_set:
        return "校准项目"
    if "填写报告" in content_set:
        return "填写报告"
    if "提交" in content_set and "是否改进：" in content_set:
        return "结果审核"
    if "查看报告" in content_set:
        return "查看报告"

    if "用户编码" in joined and "用户名称" in joined:
        return "MSA人员资质"
    if "仪器编码" in joined and "仪器名称" in joined:
        return "校准项目"

    return ""


def _merge_binary_blocks(blocks: list[dict]) -> list[dict]:
    merged: dict[str, list[str]] = {}
    order = []

    for block in blocks:
        title = block["title"]
        if title not in merged:
            merged[title] = []
            order.append(title)
        for item in block["contents"]:
            if item not in merged[title]:
                merged[title].append(item)

    order.sort(key=_binary_title_sort_key)
    pages = []
    for title in order:
        widgets = []
        for idx, text in enumerate(merged[title]):
            widgets.append(
                {"type": "text", "text": text, "x": 0, "y": idx * 32, "w": 0, "h": 24}
            )
        pages.append(
            {
                "title": title,
                "widgets": widgets,
                "source_format": "rp9-binary-fallback",
            }
        )
    return pages


def _binary_title_sort_key(title: str) -> tuple[int, str]:
    preferred = [
        "项目结构",
        "MSA计划",
        "校准项目",
        "MSA人员资质",
        "填写报告",
        "填写报告-偏倚",
        "填写报告-线性",
        "填写报告-稳定性",
        "填写报告-GR&R",
        "查看报告",
        "查看报告-偏倚",
        "查看报告-线性",
        "查看报告-稳定性",
        "查看报告-GR&R",
        "结果审核",
    ]
    try:
        return (preferred.index(title), title)
    except ValueError:
        return (len(preferred), title)


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------

def _clean_text(text: str) -> str:
    """Strip extra whitespace and handle common Axure encodings."""
    if not text:
        return ""
    # Replace HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _copy_image(src: str, data_dir: str, images_dir: str) -> str | None:
    """Copy an image from the extracted data to the output images_dir.

    Returns the relative path for use in Markdown.
    """
    if not src:
        return None

    # Normalize the source path
    src = src.replace("\\", "/")
    basename = os.path.basename(src)

    # Search for the image file in the extracted directory
    found = None
    # Try common image locations
    candidates = [
        os.path.join(data_dir, src),
        os.path.join(data_dir, "images", basename),
        os.path.join(data_dir, "..", "images", basename),
        os.path.join(data_dir, "..", "..", "images", basename),
        os.path.join(data_dir, "resources", "images", basename),
    ]
    for c in candidates:
        if os.path.isfile(c):
            found = c
            break

    # Walk the extract dir as last resort
    if not found:
        for root, _, files in os.walk(os.path.dirname(data_dir)):
            if basename in files:
                found = os.path.join(root, basename)
                break

    if found:
        dest = os.path.join(images_dir, basename)
        # Avoid overwriting existing files with same name
        counter = 1
        while os.path.exists(dest):
            name, ext = os.path.splitext(basename)
            dest = os.path.join(images_dir, f"{name}_{counter}{ext}")
            counter += 1
        shutil.copy2(found, dest)
        return os.path.relpath(dest, images_dir)

    return None


def _sort_widgets_by_position(widgets: list[dict]) -> list[dict]:
    """Sort widgets top-to-bottom, left-to-right for logical reading order.

    Groups widgets into rows by Y position, then orders left-to-right within each row.
    """
    if not widgets:
        return widgets

    # Sort by Y first, then X
    row_threshold = 20  # pixels - widgets within this Y range are in the same "row"
    sorted_by_y = sorted(widgets, key=lambda w: (w["y"], w["x"]))

    result = []
    current_row = []
    current_y = None

    for w in sorted_by_y:
        if current_y is None or abs(w["y"] - current_y) <= row_threshold:
            current_row.append(w)
            if current_y is None:
                current_y = w["y"]
        else:
            # Sort current row left-to-right and add to result
            result.extend(sorted(current_row, key=lambda ww: ww["x"]))
            current_row = [w]
            current_y = w["y"]

    result.extend(sorted(current_row, key=lambda ww: ww["x"]))
    return result


# ---------------------------------------------------------------------------
# Markdown generation
# ---------------------------------------------------------------------------

def generate_markdown(pages: list[dict], images_dir: str) -> str:
    """Generate a combined Markdown document from all pages."""
    md_lines = []

    for i, page in enumerate(pages):
        title = page.get("title", f"Page {i + 1}")
        widgets = page.get("widgets", [])

        md_lines.append(f"# {title}")
        md_lines.append("")

        if not widgets:
            md_lines.append("_No content extracted from this page._")
            md_lines.append("")
            continue

        sorted_widgets = _sort_widgets_by_position(widgets)

        # Track Y position to add spacing between visual rows
        last_y = None
        row_gap = 40  # px - gap above which we insert a blank line

        for w in sorted_widgets:
            text = w.get("text", "").strip()
            image = w.get("image", "")
            wtype = w.get("type", "")

            # Insert blank line for significant vertical gaps
            if last_y is not None and (w["y"] - last_y) > row_gap:
                md_lines.append("")

            # Image output
            if image:
                alt = text or os.path.basename(image)
                image_md_path = os.path.join(os.path.basename(images_dir), image)
                if text:
                    md_lines.append(f"![{alt}]({image_md_path})")
                    md_lines.append("")
                    md_lines.append(text)
                else:
                    md_lines.append(f"![{alt}]({image_md_path})")
                md_lines.append("")
                last_y = w["y"] + w.get("h", 0)
                continue

            # Text output — determine heading level based on widget type
            if text:
                if _is_heading_widget(wtype):
                    md_lines.append(f"## {text}")
                    md_lines.append("")
                elif _is_button_widget(wtype):
                    md_lines.append(f"> **[{text}]**")
                    md_lines.append("")
                elif _is_list_item(wtype):
                    md_lines.append(f"- {text}")
                else:
                    md_lines.append(text)
                    md_lines.append("")

                last_y = w["y"] + w.get("h", 0)

    return "\n".join(md_lines)


def generate_markdown_per_page(pages: list[dict], images_dir: str, output_dir: str) -> list[str]:
    """Generate separate Markdown files for each page. Returns list of file paths."""
    os.makedirs(output_dir, exist_ok=True)
    paths = []

    for i, page in enumerate(pages):
        title = page.get("title", f"Page {i + 1}")
        # Create safe filename
        safe_name = re.sub(r"[^\w\s-]", "", title).strip()
        safe_name = re.sub(r"[-\s]+", "-", safe_name) or f"page_{i + 1:03d}"
        md_path = os.path.join(output_dir, f"{safe_name}.md")

        # Generate single-page markdown
        md = generate_markdown([page], images_dir)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md)
        paths.append(md_path)

    # Generate index
    index_path = os.path.join(output_dir, "README.md")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("# Pages\n\n")
        for i, page in enumerate(pages):
            safe_name = re.sub(r"[^\w\s-]", "", page["title"]).strip()
            safe_name = re.sub(r"[-\s]+", "-", safe_name) or f"page_{i + 1:03d}"
            f.write(f"- [{page['title']}]({safe_name}.md)\n")
    paths.insert(0, index_path)

    return paths


def generate_dev_design_markdown(pages: list[dict], source_name: str) -> str:
    """Generate a single development-oriented design document.

    This is intentionally heuristic: Axure files rarely contain complete
    requirements metadata. The output is a structured development draft that
    should be reviewed and refined by Codex instead of shipped as raw extraction.
    """
    title = _humanize_source_name(source_name)
    modules = [_analyze_page(page) for page in pages]
    modules = [module for module in modules if module["texts"]]

    lines = [
        f"# {title} 开发设计文档",
        "",
        "## 1. 文档说明",
        "",
        f"本文档根据 `{source_name}` 原型自动解读整理，用于指导页面开发、接口设计和业务规则实现。",
        "",
        "原型中明确出现的页面、字段、操作和规则已整理为需求；无法从原型确认的内容统一放入“待确认问题”。",
        "",
        "## 2. 功能范围",
        "",
        "原型包含以下功能页面或功能片段：",
        "",
    ]

    for idx, module in enumerate(modules, start=1):
        lines.append(f"{idx}. `{module['title']}`")

    lines.extend(["", "## 3. 功能流程", "", "```mermaid", "flowchart LR"])
    for idx, module in enumerate(modules):
        node = f"N{idx + 1}"
        lines.append(f'    {node}["{_escape_mermaid(module["title"])}"]')
        if idx:
            lines.append(f"    N{idx} --> {node}")
    lines.extend(["```", "", "## 4. 通用设计规则", ""])

    common_rules = _collect_common_rules(modules)
    if common_rules:
        lines.extend(f"- {rule}" for rule in common_rules)
    else:
        lines.append("- 原型未展示全局规则，开发时需要结合业务流程补充。")

    section_no = 5
    for module in modules:
        lines.extend(_render_module_section(section_no, module))
        section_no += 1

    lines.extend(_render_data_model_section(section_no, modules))
    section_no += 1
    lines.extend(_render_api_section(section_no, modules))
    section_no += 1
    lines.extend(_render_validation_section(section_no, modules))
    section_no += 1
    lines.extend(_render_open_questions(section_no, modules))

    return "\n".join(lines).rstrip() + "\n"


def _humanize_source_name(source_name: str) -> str:
    stem = os.path.splitext(os.path.basename(source_name))[0]
    return stem.replace("_", " ").replace("-", " ").strip() or "Axure 原型"


def _analyze_page(page: dict) -> dict:
    title = page.get("title", "未命名页面").strip() or "未命名页面"
    texts = _page_texts(page)
    fields = _extract_fields(texts)
    actions = _extract_actions(texts)
    rules = _extract_rules(texts)
    options = _extract_options(texts)
    tables = _extract_table_candidates(texts, fields, actions, rules, options)

    return {
        "title": title,
        "texts": texts,
        "fields": fields,
        "actions": actions,
        "rules": rules,
        "options": options,
        "tables": tables,
    }


def _page_texts(page: dict) -> list[str]:
    widgets = _sort_widgets_by_position(page.get("widgets", []))
    texts = []
    seen = set()
    for widget in widgets:
        text = _clean_text_block(widget.get("text", ""))
        if not text or text in seen:
            continue
        texts.append(text)
        seen.add(text)
    return texts


def _clean_text_block(text: str) -> str:
    text = str(text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = "\n".join(line.strip() for line in text.split("\n") if line.strip())
    return text.strip()


def _extract_fields(texts: list[str]) -> list[dict]:
    fields = []
    seen = set()
    for text in texts:
        if _is_action_text(text) or _is_note_text(text):
            continue
        if _is_field_text(text):
            required = text.startswith("*")
            name = text.lstrip("*").strip().rstrip(":：").strip()
            if not name or name in seen:
                continue
            fields.append(
                {
                    "name": name,
                    "required": "是" if required else "否",
                    "source": "原型标记必填" if required else "原型未标必填",
                }
            )
            seen.add(name)
    return fields


def _is_field_text(text: str) -> bool:
    if len(text) > 40:
        return False
    if text.startswith("*"):
        return True
    return text.endswith((":", "："))


def _extract_actions(texts: list[str]) -> list[dict]:
    actions = []
    seen = set()
    for text in texts:
        normalized = text.strip()
        if not _is_action_text(normalized) or normalized in seen:
            continue
        actions.append({"name": normalized, "rule": _action_rule(normalized)})
        seen.add(normalized)
    return actions


def _is_action_text(text: str) -> bool:
    actions = {
        "新增",
        "修改",
        "删除",
        "查询",
        "重置",
        "确定",
        "取消",
        "保存",
        "提交",
        "上传",
        "下载",
        "下载报告",
        "导入",
        "导出",
        "同步仪器台账",
        "开始分析",
        "执行审批",
        "查看报告",
    }
    if text in actions:
        return True
    return bool(re.fullmatch(r"(修改\s+删除|《上一页|下一页》)", text))


def _action_rule(action: str) -> str:
    mapping = {
        "查询": "按查询条件刷新列表。",
        "重置": "清空查询条件或当前录入内容。",
        "新增": "打开新增弹窗或进入新增页面。",
        "修改": "打开当前记录的修改弹窗或修改页面。",
        "删除": "删除或失效当前记录；涉及历史数据时建议逻辑删除。",
        "确定": "提交弹窗内容并写入主页面。",
        "取消": "关闭当前页面或弹窗，未保存内容不保留。",
        "保存": "暂存当前信息，后续可继续编辑。",
        "提交": "提交当前业务单据或审核结果。",
        "上传": "上传业务附件。",
        "下载": "下载当前数据或报告。",
        "下载报告": "下载当前报告，原型建议 Excel 格式。",
        "导入": "通过模板批量导入数据。",
        "导出": "导出列表或报告数据。",
        "同步仪器台账": "从仪器台账同步符合条件的数据。",
        "开始分析": "根据当前填写数据执行分析并生成判定结果。",
        "执行审批": "将当前报告提交到审批或审核流程。",
        "查看报告": "打开当前任务或记录的报告详情。",
    }
    return mapping.get(action, "按原型交互执行。")


def _extract_rules(texts: list[str]) -> list[str]:
    rules = []
    seen = set()
    for text in texts:
        if _is_action_text(text) or _is_field_text(text):
            continue
        if not _is_note_text(text):
            continue
        for line in text.split("\n"):
            line = line.strip()
            if _is_action_text(line) or _is_field_text(line):
                continue
            if line.endswith((":", "：")) and len(line) <= 12:
                continue
            if line and line not in seen:
                rules.append(line)
                seen.add(line)
    return rules


def _is_note_text(text: str) -> bool:
    if len(text) > 24 and any("\u4e00" <= ch <= "\u9fff" for ch in text):
        return True
    keywords = (
        "规则",
        "判定",
        "需要",
        "支持",
        "依据",
        "根据",
        "默认",
        "计算",
        "生成",
        "同步",
        "导出",
        "导入",
        "显示",
        "不显示",
        "不保存",
        "暂存",
        "带出",
        "配置",
        "上传",
        "删除",
        "合格",
        "不合格",
        "接受",
        "改进",
    )
    formula_symbols = ("%","<",">","≤","≥","=","×","→")
    return any(keyword in text for keyword in keywords) or any(
        symbol in text for symbol in formula_symbols
    )


def _extract_options(texts: list[str]) -> list[str]:
    option_words = {
        "合格",
        "不合格",
        "启用",
        "禁用",
        "停用",
        "校准中",
        "维修中",
        "有条件接受",
        "符合要求",
    }
    options = []
    for text in texts:
        if text in option_words and text not in options:
            options.append(text)
    return options


def _extract_table_candidates(
    texts: list[str],
    fields: list[dict],
    actions: list[dict],
    rules: list[str],
    options: list[str],
) -> list[str]:
    excluded = {field["name"] for field in fields}
    excluded.update(action["name"] for action in actions)
    excluded.update(rules)
    excluded.update(options)

    candidates = []
    for text in texts:
        clean = text.strip().lstrip("*").rstrip(":：").strip()
        if not clean or clean in excluded:
            continue
        if len(clean) > 30:
            continue
        if re.fullmatch(r"(第\d+页|共\d+页|共\d+条|\d+条/页|\d+)", clean):
            continue
        if clean not in candidates:
            candidates.append(clean)
    return candidates[:40]


def _collect_common_rules(modules: list[dict]) -> list[str]:
    rules = []
    for module in modules:
        for rule in module["rules"]:
            if any(keyword in rule for keyword in ("暂存", "不保存", "带出", "配置", "同步", "导出")):
                if rule not in rules:
                    rules.append(rule)
    return rules[:12]


def _render_module_section(section_no: int, module: dict) -> list[str]:
    lines = [
        "",
        f"## {section_no}. {module['title']}",
        "",
        "### 页面目标",
        "",
        f"用于完成 `{module['title']}` 相关业务操作。开发时应以本节字段、操作和规则为页面实现依据。",
        "",
    ]

    if module["fields"]:
        lines.extend(["### 表单字段", "", "| 字段 | 必填 | 说明 |", "| --- | --- | --- |"])
        for field in module["fields"]:
            lines.append(f"| {field['name']} | {field['required']} | {field['source']} |")
        lines.append("")

    if module["tables"]:
        lines.extend(["### 列表/表格字段", "", "| 字段 | 说明 |", "| --- | --- |"])
        for item in module["tables"]:
            lines.append(f"| {item} | 原型页面展示字段，需结合业务确认数据来源 |")
        lines.append("")

    if module["actions"]:
        lines.extend(["### 页面操作", "", "| 操作 | 交互/业务规则 |", "| --- | --- |"])
        for action in module["actions"]:
            lines.append(f"| {action['name']} | {action['rule']} |")
        lines.append("")

    if module["options"]:
        lines.extend(["### 枚举值", "", "| 枚举值 | 说明 |", "| --- | --- |"])
        for option in module["options"]:
            lines.append(f"| {option} | 原型展示值 |")
        lines.append("")

    if module["rules"]:
        lines.extend(["### 业务规则", ""])
        lines.extend(f"- {rule}" for rule in module["rules"])
        lines.append("")

    lines.extend(["### 开发落点", ""])
    lines.extend(_module_dev_notes(module))
    lines.append("")
    return lines


def _module_dev_notes(module: dict) -> list[str]:
    notes = []
    title = module["title"]
    actions = {action["name"] for action in module["actions"]}
    if any(action in actions for action in ("查询", "重置")):
        notes.append("- 需要实现查询条件、分页列表和重置行为。")
    if any(action in actions for action in ("新增", "修改", "删除")):
        notes.append("- 需要实现新增/修改/删除流程，并明确删除是否为逻辑删除。")
    if any(action in actions for action in ("导入", "导出")):
        notes.append("- 需要提供导入模板和导出文件格式。")
    if "报告" in title or "分析" in "\n".join(module["texts"]):
        notes.append("- 需要保存原始录入数据和分析结果，便于报告查看与追溯。")
    if any("判定" in rule for rule in module["rules"]):
        notes.append("- 需要将判定规则封装到后端或可复用服务，避免前端写死。")
    if not notes:
        notes.append("- 原型信息较少，建议开发前补充状态、接口和字段来源。")
    return notes


def _render_data_model_section(section_no: int, modules: list[dict]) -> list[str]:
    lines = ["", f"## {section_no}. 数据模型建议", ""]
    lines.append("以下为通用开发建议，字段命名可按项目规范调整。")
    for module in modules:
        table_name = _suggest_table_name(module["title"])
        lines.extend(["", f"### {table_name}", "", "| 字段 | 说明 |", "| --- | --- |"])
        lines.append("| id | 主键 |")
        for field in module["fields"][:12]:
            lines.append(f"| {_to_snake_case(field['name'])} | {field['name']} |")
        if module["tables"]:
            lines.append("| list_snapshot | 列表展示字段快照，复杂表格建议拆子表或 JSON |")
        if module["rules"]:
            lines.append("| business_status | 业务状态或判定结果 |")
        lines.append("| created_by / created_at | 创建人 / 创建时间 |")
        lines.append("| updated_by / updated_at | 修改人 / 修改时间 |")
    lines.append("")
    return lines


def _render_api_section(section_no: int, modules: list[dict]) -> list[str]:
    lines = [
        "",
        f"## {section_no}. 接口建议",
        "",
        "| 方法 | 路径 | 说明 |",
        "| --- | --- | --- |",
    ]
    for module in modules:
        resource = _to_resource_name(module["title"])
        actions = {action["name"] for action in module["actions"]}
        if actions & {"查询", "重置"} or module["tables"]:
            lines.append(f"| GET | `/api/{resource}` | 分页查询 `{module['title']}` |")
        if actions & {"新增", "确定"}:
            lines.append(f"| POST | `/api/{resource}` | 新增 `{module['title']}` |")
        if "修改" in actions:
            lines.append(f"| PUT | `/api/{resource}/{{id}}` | 修改 `{module['title']}` |")
        if "删除" in actions:
            lines.append(f"| DELETE | `/api/{resource}/{{id}}` | 删除或失效 `{module['title']}` |")
        if "导入" in actions:
            lines.append(f"| POST | `/api/{resource}/import` | 导入 `{module['title']}` 数据 |")
        if "导出" in actions or "下载报告" in actions:
            lines.append(f"| GET | `/api/{resource}/export` | 导出或下载 `{module['title']}` |")
        if "开始分析" in actions:
            lines.append(f"| POST | `/api/{resource}/analyze` | 执行 `{module['title']}` 分析 |")
        if "提交" in actions or "执行审批" in actions:
            lines.append(f"| POST | `/api/{resource}/submit` | 提交 `{module['title']}` |")
    lines.append("")
    return lines


def _render_validation_section(section_no: int, modules: list[dict]) -> list[str]:
    lines = [
        "",
        f"## {section_no}. 校验和异常处理",
        "",
        "| 场景 | 校验规则 |",
        "| --- | --- |",
    ]
    for module in modules:
        required = [field["name"] for field in module["fields"] if field["required"] == "是"]
        if required:
            lines.append(
                f"| {module['title']}保存 | 必填字段不能为空：{', '.join(required)} |"
            )
        if any(action["name"] == "删除" for action in module["actions"]):
            lines.append(f"| {module['title']}删除 | 涉及历史数据时建议逻辑删除或失效处理 |")
        if any(action["name"] == "开始分析" for action in module["actions"]):
            lines.append(f"| {module['title']}分析 | 原始数据必须完整且满足计算规则后才能开始分析 |")
    lines.append("| 接口异常 | 展示明确错误信息，避免只提示系统异常 |")
    lines.append("")
    return lines


def _render_open_questions(section_no: int, modules: list[dict]) -> list[str]:
    lines = ["", f"## {section_no}. 待确认问题", ""]
    questions = [
        "各页面的最终菜单名称、路由和权限范围需要确认。",
        "列表字段的数据来源、排序方式和默认筛选条件需要确认。",
        "新增、修改、删除是否需要完整审批流需要确认。",
        "导入模板、导出文件格式和下载文件命名规则需要确认。",
    ]
    if any("分析" in "\n".join(module["texts"]) or "判定" in "\n".join(module["texts"]) for module in modules):
        questions.append("分析公式和判定阈值需要业务确认，并建议后端统一实现。")
    for idx, question in enumerate(questions, start=1):
        lines.append(f"{idx}. {question}")
    lines.append("")
    return lines


def _suggest_table_name(title: str) -> str:
    return _to_snake_case(title) or "prototype_entity"


def _to_resource_name(title: str) -> str:
    value = _to_snake_case(title).replace("_", "-")
    return value or "prototype"


def _to_snake_case(text: str) -> str:
    text = text.strip().strip("*").rstrip(":：")
    replacements = {
        "仪器编码": "instrument_code",
        "仪器名称": "instrument_name",
        "用户编码": "user_code",
        "用户名称": "user_name",
        "创建人": "created_by",
        "创建时间": "created_at",
        "修改人": "updated_by",
        "修改时间": "updated_at",
        "测量结果": "measure_result",
        "测量特性": "measure_characteristic",
        "分析人员": "analyst",
        "测量人员": "measure_person",
        "基准件名称": "base_part_name",
        "规格上限": "spec_upper",
        "规格下限": "spec_lower",
        "下限": "lower_limit",
        "上限": "upper_limit",
        "过程变异": "process_variation",
        "产品规格公差": "product_tolerance",
    }
    if text in replacements:
        return replacements[text]
    ascii_text = re.sub(r"[^0-9A-Za-z]+", "_", text).strip("_").lower()
    if ascii_text:
        return ascii_text
    encoded = "_".join(f"u{ord(ch):x}" for ch in text if not ch.isspace())
    return encoded[:80].strip("_")


def _escape_mermaid(text: str) -> str:
    return text.replace('"', "'")


def _is_heading_widget(wtype: str) -> bool:
    """Check if widget type corresponds to a heading."""
    heading_types = {"h1", "h2", "h3", "h4", "h5", "h6", "heading",
                     "header", "title", "pagetitle", "sectionheader",
                     "SectionHeader", "PageTitle"}
    return wtype.lower() in heading_types


def _is_button_widget(wtype: str) -> bool:
    """Check if widget type corresponds to a button."""
    button_types = {"button", "btn", "linkbutton", "primarybutton",
                    "Button", "LinkButton", "PrimaryButton"}
    return wtype.lower() in button_types


def _is_list_item(wtype: str) -> bool:
    """Check if widget type corresponds to a list item."""
    list_types = {"listitem", "listboxitem", "bullet", "bulletpoint",
                  "listelement", "ListItem", "BulletPoint"}
    return wtype.lower() in list_types


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Convert Axure RP (.rp) files to Markdown documents"
    )
    parser.add_argument("input", help="Path to the .rp file")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output directory for Markdown files (default: next to input file)",
    )
    parser.add_argument(
        "--images-dir",
        default=None,
        help="Subdirectory name for extracted images (default: images/)",
    )
    parser.add_argument(
        "--single-file",
        action="store_true",
        help="Generate a single combined Markdown file instead of per-page files",
    )
    parser.add_argument(
        "--dev-design",
        action="store_true",
        help="Generate one development design document instead of raw extraction",
    )
    parser.add_argument(
        "--filename",
        default=None,
        help="Output Markdown filename for --single-file or --dev-design",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep the temporary extraction directory (for debugging)",
    )
    args = parser.parse_args()

    # Validate input
    if not os.path.isfile(args.input):
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Determine output dir
    output_dir = args.output
    if not output_dir:
        base = os.path.splitext(args.input)[0]
        output_dir = f"{base}_md"

    images_subdir = args.images_dir or "images"
    images_dir = os.path.join(output_dir, images_subdir)
    os.makedirs(images_dir, exist_ok=True)

    # Extract and parse
    pages = []
    with tempfile.TemporaryDirectory(prefix="axure2prd_") as tmpdir:
        print(f"Extracting: {args.input}")
        try:
            extract_zip(args.input, tmpdir)
        except zipfile.BadZipFile:
            print("Input is not a ZIP-based RP file; trying RP9 binary fallback.")
            pages = parse_rp_binary(args.input, images_dir)
            fmt = "rp9-binary"
        except OSError as e:
            print(f"Error: Failed to extract .rp file: {e}", file=sys.stderr)
            sys.exit(1)
        else:
            fmt = detect_format(tmpdir)

            if fmt == "rp9":
                pages = parse_rp9(tmpdir, images_dir)
            else:
                pages = parse_rp10(tmpdir, images_dir)

        print(f"Detected format: {fmt}")

        if args.keep_temp and fmt != "rp9-binary":
            kept = tempfile.mkdtemp(prefix="axure2prd_kept_")
            shutil.copytree(tmpdir, kept, dirs_exist_ok=True)
            print(f"Temp dir kept at: {kept}")

    if not pages:
        print("Warning: No pages extracted from the .rp file.", file=sys.stderr)
        sys.exit(0)

    print(f"Extracted {len(pages)} page(s)")

    # Generate Markdown
    if args.dev_design:
        md_content = generate_dev_design_markdown(pages, os.path.basename(args.input))
        md_filename = args.filename or f"{Path(args.input).stem}.md"
        md_path = os.path.join(output_dir, md_filename)
        os.makedirs(output_dir, exist_ok=True)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"Generated: {md_path}")
    elif args.single_file:
        md_content = generate_markdown(pages, images_dir)
        md_filename = args.filename or "output.md"
        md_path = os.path.join(output_dir, md_filename)
        os.makedirs(output_dir, exist_ok=True)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"Generated: {md_path}")
    else:
        md_paths = generate_markdown_per_page(pages, images_dir, output_dir)
        for p in md_paths:
            print(f"Generated: {p}")

    # Report image count
    image_count = len(os.listdir(images_dir))
    if image_count > 0:
        print(f"Extracted {image_count} image(s) to: {images_dir}")

    print("Done.")


if __name__ == "__main__":
    main()
