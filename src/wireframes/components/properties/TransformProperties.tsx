/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Button, Col, InputNumber, Row, Tooltip } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import * as React from 'react';
import { Rotation, useEventCallback, Vec2 } from '@app/core';
import { useAppDispatch } from '@app/store';
import {
    ASPECT_RATIO,
    applyAspectRatio,
    changeItemsAppearance,
    getDiagram,
    getDiagramId,
    getSelection,
    lockAspectRatio,
    parseAspectRatio,
    Transform,
    transformItems,
    useStore,
} from '@app/wireframes/model';

export const TransformProperties = () => {
    const dispatch = useAppDispatch();
    const selectedDiagram = useStore(getDiagram)!;
    const selectedDiagramId = useStore(getDiagramId);
    const selectedIds = selectedDiagram?.selectedIds;
    const selectionSet = useStore(getSelection)!;
    const selectedItems = selectionSet.selectedItems;
    const [rotation, setRotation] = React.useState(Rotation.ZERO);

    const selectedItem = selectedItems && selectedItems.length === 1 ? selectedItems[0] : null;

    // Group items have no appearance, so the aspect ratio cannot be locked for them.
    const aspectRatio = selectedItem && selectedItem.appearance ? parseAspectRatio(selectedItem.appearance.get(ASPECT_RATIO)) : null;
    const canLock = !!selectedItem && !!selectedItem.appearance;

    const doTransform = useEventCallback((update: (oldBounds: Transform) => Transform) => {
        const oldBounds = transform;

        if (!oldBounds) {
            return;
        }

        const newBounds = update(oldBounds);
        
        if (newBounds.equals(oldBounds)) {
            return;
        }

        dispatch(transformItems(selectedDiagram, selectedItems, oldBounds, newBounds));

    });

    const [x, setX, commitX] = useImmediateDebounceCallback(value => {
        doTransform(oldBounds => {
            const dx = value - (oldBounds.position.x - 0.5 * oldBounds.size.x);

            // Move by the delta between new and old position, because we move relative to the bounding box.
            return oldBounds.moveBy(new Vec2(dx, 0));
        });
    }, 0, 50);

    const [y, setY, commitY] = useImmediateDebounceCallback(value => {
        doTransform(oldBounds => {
            const dy = value - (oldBounds.position.y - 0.5 * oldBounds.size.y);
            
            // Move by the delta between new and old position, because we move relative to the bounding box.
            return oldBounds.moveBy(new Vec2(0, dy));
        });
    }, 0, 50);

    const [w, setW, commitW] = useImmediateDebounceCallback(value => {
        doTransform(oldBounds => {
            let size = new Vec2(value, oldBounds.size.y);

            // When the aspect ratio is locked, adjust the height accordingly.
            if (aspectRatio) {
                size = applyAspectRatio(size, aspectRatio, 'x');
            }
            
            // Size by keeping the left top corner sticky.
            return oldBounds.resizeTopLeft(size);
        });
    }, 0, 50);

    const [h, setH, commitH] = useImmediateDebounceCallback(value => {
        doTransform(oldBounds => {
            let size = new Vec2(oldBounds.size.x, value);

            // When the aspect ratio is locked, adjust the width accordingly.
            if (aspectRatio) {
                size = applyAspectRatio(size, aspectRatio, 'y');
            }
            
            // Size by keeping the left top corner sticky.
            return oldBounds.resizeTopLeft(size);
        });
    }, 0, 50);

    const [r, setR, commitR] = useImmediateDebounceCallback(value => {
        doTransform(oldBounds => {
            const rotation = Rotation.fromDegree(value);
        
            // Rotate to the value.
            return oldBounds.rotateTo(rotation);
        });
    }, 0, 50);

    const commitAll = useEventCallback(() => {
        commitX();
        commitY();
        commitW();
        commitH();
        commitR();
    });

    React.useEffect(() => {
        setRotation(Rotation.ZERO);
    }, [selectedIds]);

    const doToggleAspectRatioLock = useEventCallback(() => {
        if (!selectedItem || !selectedDiagram || !transform) {
            return;
        }

        if (aspectRatio) {
            // Unlock: clear the stored ratio.
            dispatch(changeItemsAppearance(selectedDiagram, [selectedItem], ASPECT_RATIO, '', true));
        } else {
            // Lock: remember the current aspect ratio.
            dispatch(changeItemsAppearance(selectedDiagram, [selectedItem], ASPECT_RATIO, lockAspectRatio(transform.size), true));
        }
    });

    const transform = React.useMemo(() => {
        if (!selectedItems) {
            return;
        }
    
        if (selectedItems.length === 0) {
            return Transform.ZERO;
        } else if (selectedItems.length === 1) {
            return selectedItems[0].bounds(selectedDiagram);
        } else {
            const bounds = selectedItems.map(x => x.bounds(selectedDiagram!));

            return Transform.createFromTransformationsAndRotation(bounds, rotation);
        }
    }, [rotation, selectedDiagram, selectedItems]);
    
    React.useEffect(() => {
        if (!transform) {
            return;
        }
    
        setX(transform.position.x - 0.5 * transform.size.x);
        setY(transform.position.y - 0.5 * transform.size.y);
        setW(transform.size.x);
        setH(transform.size.y);
        setR(transform.rotation.degree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transform]);

    if (!selectedDiagramId) {
        return null;
    }

    return (
        <>
            <Row className='property' gutter={4}>
                <Col span={12}>
                    <InputNumber prefix='x' value={x} onChange={setX as any} onPressEnter={commitAll} onBlur={commitAll} />
                </Col>
                <Col span={12}>
                    <InputNumber prefix='y' value={y} onChange={setY as any} onPressEnter={commitAll} onBlur={commitAll} />
                </Col>
            </Row>

            <Row className='property' gutter={4}>
                <Col span={12}>
                    <InputNumber prefix='w' value={w} onChange={setW as any} onPressEnter={commitAll} onBlur={commitAll} />
                </Col>
                <Col span={12}>
                    <InputNumber prefix='h' value={h} onChange={setH as any} onPressEnter={commitAll} onBlur={commitAll} />
                </Col>
            </Row>

            <Row className='property' gutter={4}>
                <Col span={12}>
                    <Tooltip title="锁定宽高比（拖拽手柄时按住 Alt 可临时等比缩放）">
                        <Button
                            block
                            type={aspectRatio ? 'primary' : 'default'}
                            icon={aspectRatio ? <LockOutlined /> : <UnlockOutlined />}
                            disabled={!canLock}
                            onClick={doToggleAspectRatioLock}
                        />
                    </Tooltip>
                </Col>
                <Col span={12}>
                    <InputNumber prefix='r' value={r} onChange={setR as any} onPressEnter={commitAll} onBlur={commitAll} />
                </Col>
            </Row>
        </>
    );
};

function useImmediateDebounceCallback<T>(callback: ((value: T) => void), initial: T, delay = 500): [T, (value: T) => void, () => void] {
    const [state, setState] = React.useState<T>(initial);

    const callbackHook = useEventCallback(callback);
    const stateRef = React.useRef(state);
    stateRef.current = state;

    const commit = React.useCallback(() => {
        callbackHook(stateRef.current);
    }, [callbackHook]);

    React.useEffect(() => {
        const currentState = state;

        const timer = setTimeout(() => {
            callbackHook(currentState);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [callbackHook, state]);

    return [state, setState, commit];
}