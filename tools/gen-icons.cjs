// xdraft 图标尺寸库生成器
// 用法: NODE_PATH=<managed node workspace>/node_modules node gen-icons.cjs
// 依赖: canvas (npm i canvas, 预编译含 win32-x64)
//
// 设计源 = public/favicon.svg: 紫蓝渐变(#667eea -> #764ba2)圆角方块 + 白色 "Xd"。
// 先在 1024px 母版上绘制, 再高质量降采样到各尺寸, 保证所有比例观感一致。
// 产物:
//   electron/icons/icon_{16,24,32,48,64,128,256,512}.png
//   electron/icons/icon.ico        (多尺寸 PNG-in-ICO, 256/128/64/48/32/16)
//   electron/icon.png              (512px, 兼容 linux.icon / 旧引用)

const path = require('path');
const fs = require('fs');
const { createCanvas, registerFont } = require('canvas');

registerFont('C:/Windows/Fonts/segoeuib.ttf', { family: 'Segoe UI', weight: 'bold' });

const GRAD_FROM = '#667eea';
const GRAD_TO = '#764ba2';
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const MASTER = 1024;
const K = MASTER / 64; // 设计稿(64px)到母版的缩放系数

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawMaster() {
    const canvas = createCanvas(MASTER, MASTER);
    const ctx = canvas.getContext('2d');

    // 1) 渐变圆角方块 (对应 SVG rect 2,2 60x60 rx14)
    const grad = ctx.createLinearGradient(2 * K, 2 * K, 62 * K, 62 * K);
    grad.addColorStop(0, GRAD_FROM);
    grad.addColorStop(1, GRAD_TO);
    roundedRect(ctx, 2 * K, 2 * K, 60 * K, 60 * K, 14 * K);
    ctx.fillStyle = grad;
    ctx.fill();

    // 2) 白色 "Xd" 居中 (对应 SVG text 30px/800, 按字体实测度量垂直居中)
    ctx.font = `bold ${30 * K}px 'Segoe UI'`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    const m = ctx.measureText('Xd');
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const textH = ascent + descent;
    const cx = 32 * K - m.width / 2;
    const baseline = 32 * K - textH / 2 + ascent - 1.2 * K; // -1.2K 轻微上移做光学居中
    ctx.fillText('Xd', cx, baseline);

    return canvas;
}

function writeIco(pngBuffers, file) {
    // ICO 容器: 6 字节头 + 每图 16 字节目录 + PNG 数据 (PNG-in-ICO, Vista+ 支持)
    const count = pngBuffers.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(count, 4);

    const entries = [];
    let offset = 6 + 16 * count;
    for (const { size, data } of pngBuffers) {
        const e = Buffer.alloc(16);
        e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
        e.writeUInt8(size >= 256 ? 0 : size, 1); // height
        e.writeUInt8(0, 2);  // palette
        e.writeUInt8(0, 3);  // reserved
        e.writeUInt16LE(1, 4);  // color planes
        e.writeUInt16LE(32, 6); // bits per pixel
        e.writeUInt32LE(data.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += data.length;
        entries.push(e);
    }

    fs.writeFileSync(file, Buffer.concat([header, ...entries, ...pngBuffers.map(b => b.data)]));
}

function main() {
    const outDir = path.join(__dirname, '..', 'electron', 'icons');
    fs.mkdirSync(outDir, { recursive: true });

    const master = drawMaster();

    // 各尺寸 PNG (高质量降采样)
    const rendered = new Map();
    for (const size of SIZES) {
        const c = createCanvas(size, size);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(master, 0, 0, size, size);
        const buf = c.toBuffer('image/png');
        rendered.set(size, buf);
        fs.writeFileSync(path.join(outDir, `icon_${size}.png`), buf);
        console.log(`icon_${size}.png  ${buf.length} bytes`);
    }

    // 多尺寸 ICO (Windows 安装器 / exe / 任务栏)
    const icoSizes = [256, 128, 64, 48, 32, 16];
    writeIco(icoSizes.map(size => ({ size, data: rendered.get(size) })),
        path.join(outDir, 'icon.ico'));
    console.log(`icon.ico  (${icoSizes.join(', ')})`);

    // 512 覆盖 electron/icon.png — linux.icon 与 main.js 的旧引用无需改动
    fs.writeFileSync(path.join(__dirname, '..', 'electron', 'icon.png'), rendered.get(512));
    console.log('electron/icon.png  (512, 覆盖旧版图形)');
}

main();
