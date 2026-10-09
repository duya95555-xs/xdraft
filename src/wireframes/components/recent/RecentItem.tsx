/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { DownloadOutlined } from '@ant-design/icons';
import { Button, Col, Row, Typography } from 'antd';
import { formatDistanceToNow } from 'date-fns';
import * as React from 'react';

export interface RecentItemProps {
    // 显示的文档名。
    name: string;

    // 最后保存时间。
    date: number;

    // 点击打开。
    onLoad: () => void;
}

export const RecentItem = React.memo((props: RecentItemProps) => {
    const { name, date, onLoad } = props;

    return (
        <>
            <Row className='recent-item' wrap={false}>
                <Col flex='auto'>
                    <div>
                        <Typography.Text strong>{name}</Typography.Text>
                    </div>
                    <div>
                        <Typography.Text type='secondary'>{formatDistanceToNow(new Date(date), { addSuffix: true })}</Typography.Text>
                    </div>
                </Col>

                <Col flex='none'>
                    <Button onClick={onLoad}>
                        <DownloadOutlined />
                    </Button>
                </Col>
            </Row>
        </>
    );
});
