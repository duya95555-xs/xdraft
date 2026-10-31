/*
 * xdraft - 形状样式记忆
 *
 * 需求(1.0.4-5):形状被用户改过样式(颜色/线宽/字号等)后,默认记住这套风格;
 * 下次从组件库拖入同类型形状时自动套用,直到点"恢复默认"。
 *
 * 存储约定:
 *   localStorage["xdraft.shapeStyleMemory"] = { [renderer]: { [appearanceKey]: value } }
 * 只记 appearance 外观键(尺寸/位置不记 —— 那是几何,不是风格)。
*/

const STORAGE_KEY = 'xdraft.shapeStyleMemory';

type StyleMemory = Record<string, Record<string, any>>;

function loadMemory(): StyleMemory {
    try {
        return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function saveMemory(memory: StyleMemory) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
        // 存储不可用(隐私模式等)时静默降级:本次会话内记忆仍然生效是不保证的,
        // 但不能让"记住样式"这种便利功能把主流程搞挂。
    }
}

// 某类形状被记住的风格。没有记忆时返回 undefined。
export function getRememberedStyle(renderer: string): Record<string, any> | undefined {
    const remembered = loadMemory()[renderer];

    return remembered && Object.keys(remembered).length > 0 ? { ...remembered } : undefined;
}

// 记录一次外观改动:同类型形状今后默认使用这套值。
// 只在值确实变化时才写存储,避免拖动时的高频调用狂写 localStorage。
export function rememberStyle(renderer: string, key: string, value: any) {
    const memory = loadMemory();
    const style = memory[renderer] || {};

    if (JSON.stringify(style[key]) === JSON.stringify(value)) {
        return;
    }

    style[key] = value;
    memory[renderer] = style;

    saveMemory(memory);
}

// 恢复默认:清除某类形状的记忆(下次拖入回到 plugin.defaultAppearance())。
export function forgetStyle(renderer: string) {
    const memory = loadMemory();

    if (memory[renderer]) {
        delete memory[renderer];

        saveMemory(memory);
    }
}

// 某类形状是否有被记住的风格(用于"恢复默认"按钮的显隐)。
export function hasRememberedStyle(renderer: string): boolean {
    return !!getRememberedStyle(renderer);
}
