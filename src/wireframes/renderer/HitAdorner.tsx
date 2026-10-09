/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Engine, EngineHitEvent, Listener } from '@app/wireframes/engine';
import { DiagramItem } from '@app/wireframes/model';

export interface HitAdornerProps {
    // The current engine.
    engine: Engine;

    // The last item that was hit by a mouse down.
    hitItem: React.MutableRefObject<DiagramItem | null>;
}

// A transparent adorner that records the last hit item, e.g. to resolve the
// target of a context menu click. It never blocks the event pipeline.
export class HitAdorner extends React.PureComponent<HitAdornerProps> implements Listener {
    constructor(props: HitAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: HitAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }

            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }
        }
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }
    }

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        this.props.hitItem.current = event.item ?? null;

        next(event);
    }

    public render() {
        return null;
    }
}
