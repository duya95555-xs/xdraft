"""Axure RP 8 .rp 解析工具包 (M1)。"""

from .rpformat import RpEntry, Token, open_rp, tokenize  # noqa: F401
from .extract import extract_page, summarize_pages  # noqa: F401
