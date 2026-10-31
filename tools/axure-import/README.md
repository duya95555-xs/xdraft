# axure-import (M1)

Axure RP 8 `.rp` 解析与 import report 生成。零依赖(仅 Python 3.10+ 标准库)。

## 用法

```bash
cd tools/axure-import

# 单文件导出控件树 JSON(页/控件类型/文本/几何候选)
python -m axure_import.cli dump <file.rp> [--out out.json]

# 批量 import report(目录或文件列表)
python -m axure_import.cli report <dir|file.rp ...> [--out report.json]
```

## 格式结论(2026-09-28 逆向所得,样本 37 个真实文件,Axure 8.0.0.3293)

- `.rp` = 标准 ZIP;页面在 `Page/<hash>/<id>.rppkg`,母版在 `Master/...`(实测 284 个母版)
- `.rppkg` = Axure 自定义二进制序列化:
  - u32 小端长度前缀 + UTF-8 字符串(可含 CJK)
  - 裸 u32(计数/ID/哈希表)
  - 布局: `item-infos` 头 -> 属性 ID 元组表 -> **对象实例表(字节编码)** ->
    类/属性 schema 字符串表(`Axure:DiagramObject:<Type>`) -> 哈希表区(30 桶)
- 实例表破译(第二轮逆向):
  - 对象记录为 **4 字节定长**,每字节是小型 ID(指向字符串表/类表)
  - 样例: `(8,4),(8,5)...(8,17)` = 16 个同类对象,序号 4..17 连续
  - 类 ID(如 8)映射到 `Axure:DiagramObject:Xxx` 类名的规则待建立
  - 页名在 `DesignDocument` 的 `SiteTreeMap` 里,id↔name 绑定待 M2

## 实例区结构(第三轮,probe_structure.py 可复现)

- tokenizer 重同步会让区起点落在非 4 对齐字节,**解析前需按 4 对齐修正**
- 页面包布局(按序): item-infos 头 -> 属性 ID 元组表(985 词) -> 位图/邻接表区 ->
  schema 字符串表 -> **实例数据区(0x8C0 哨兵分隔的记录流)** -> 30 桶哈希区 ->
  大对象区(两个状态各 ~825KB,md5 不同,非副本)
- 记录流特征: `(key, value)` 对序列,key=8 的值域呈连续整数段(2..18),
  疑似 "类/属性 ID → 实例 ID 集合" 邻接表;哨兵 `0x000008C0` 后跟 `(19, N, ...)`
  三元组;出现 1001/1002/1003(0x3E9..) 疑似字符串表引用;`0x333333FF` = RGBA 颜色内联
- 高位 tag 模型: 部分区域 u32 = `(tag:8 << 24) | payload:24`(tag 8 最频繁),
  但非全部词适用,tag 语义表待校准
- **推断已到极限,需要地面真值**: 见文末差分实验

## 下一步: 差分实验(获取地面真值的最快路径)

在 Axure 中打开一个小 .rp,把某个控件右移 +100px 另存为 v2,对两文件做字节差分,
即可精确锁定坐标编码的字节位置、精度(int/fixed/float)和属性绑定。
已有版本对(壹点壹客 v1.0/v1.1 等)可做初步差分,但可控实验更干净。

探针脚本: `python probe_structure.py <file.rp>`

## M1 提取置信度

| 字段 | 置信度 | 说明 |
|---|---|---|
| widget_types | HIGH | schema 类名清单(数量=schema 出现次数,非精确实例数) |
| texts | HIGH | 实例/默认文本(CJK 全收,英文要求含空格) |
| page_name | MED | 目前多为空,见上 |
| geometry_candidates | LOW | 全流扫描 x,y,w,h 四元组,坐标编码待精确逆向 |

## 已知问题 / M2 待办

1. 实例几何编码未破译(疑似打包在哈希表后的实例区,含浮点)——转换 Diagram 的前提
2. 页名↔包 ID 绑定(解析 SiteTreeMap node-table)
3. tokenizer 纯 Python,116MB 文件约 2m40s;如需提速改 bytes 正则或转 C
4. 字体族名("Arial Normal" 等)混入 texts,需黑名单过滤

## 全库扫描结果(见 ../../out/import-report.json)

37 文件 / 1056 页 / 284 母版 / 0 解析失败。
控件类型 TOP: RichTextPanel 2499, VectorShape 1931, ImageBox 1404, DynamicPanel 933, Layer 729, ReferenceDiagramObject 686, ImageMapRegion 469, Repeater 437, TextBox 261, ButtonShape 251。
