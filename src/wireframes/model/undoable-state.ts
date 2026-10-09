/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Action } from 'redux';

interface State<T> {
    state: T;
    action?: any;
}

export class UndoableState<T> {
    public get firstState() {
        return this.past[0]?.state || this.presentState.state;
    }

    public get canUndo() {
        return this.past.length > 0;
    }

    public get canRedo() {
        return this.future.length > 0;
    }

    public get present() {
        return this.presentState.state;
    }

    public get lastAction() {
        return this.presentState.action;
    }

    // 单调递增的"修改计数": 只有真的改了文档内容才会变大。
    // 被 actionsToIgnore 忽略的动作(选中组件 / 切换页面)不计数 —— 这正是判断
    // "有没有未保存改动"所需的判据(与 LoadingState.savedRevision 比较)。
    //
    // 注意不能用 this.actions 做判据: 它是 getter, 每次访问都新建一个数组, 引用比较恒为 false。
    public get revision() {
        return this.revisionValue;
    }

    public get actions(): ReadonlyArray<Action> {
        const results = this.past.map(s => s.action).filter(x => !!x);

        if (this.presentState.action) {
            results.push(this.presentState.action);
        }

        return results;
    }

    private constructor(
        private readonly past: State<T>[],
        private readonly pastCapacity: number,
        private readonly future: State<T>[],
        private readonly presentState: State<T>,
        private readonly revisionValue: number,
    ) {
        Object.freeze(this);
    }

    public static create<T>(present: T, action?: Action, capacity = 50) {
        return new UndoableState<T>([], capacity, [], { state: present, action }, 0);
    }

    public undo(): UndoableState<T> {
        if (!this.canUndo) {
            return this;
        }

        const newPresent = this.past[this.past.length - 1];
        const newPast = this.past.slice(0, this.past.length - 1);

        const newFuture = [this.presentState, ...this.future];

        return new UndoableState(newPast, this.pastCapacity, newFuture, newPresent, this.revisionValue + 1);
    }

    public redo(): UndoableState<T> {
        if (!this.canRedo) {
            return this;
        }

        const newPresent = this.future[0];
        const newFuture = this.future.slice(1);

        const newPast = [...this.past, this.presentState];

        return new UndoableState(newPast, this.pastCapacity, newFuture, newPresent, this.revisionValue + 1);
    }

    public executed(state: T, action?: Action) {
        const newPresent = { state, action };
        const newPast = [...this.past, this.presentState];

        if (newPast.length > this.pastCapacity) {
            newPast.splice(0, 1);
        }

        return new UndoableState(newPast, this.pastCapacity, [], newPresent, this.revisionValue + 1);
    }

    public replacePresent(state: T, action?: Action) {
        // 传了 action = 动作被合并进上一步, 内容确实变了 ⇒ 计数 +1;
        // 不传 = 该动作在 actionsToIgnore 里(选中等), 不改内容 ⇒ 计数不变。
        const newPresent = { state, action: action || this.presentState.action };
        const nextRevision = action ? this.revisionValue + 1 : this.revisionValue;

        return new UndoableState(this.past, this.pastCapacity, this.future, newPresent, nextRevision);
    }
}
