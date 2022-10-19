/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import Dropdown from 'react-bootstrap/Dropdown';

import { createDesktopShortcut } from '../../../../ipc/createDesktopShortcut';
import { useLauncherSelector } from '../../../util/hooks';
import { DisplayedApp, getIsAnAppInProgress } from '../appsSlice';

const CreateShortcut: React.FC<{ app: DisplayedApp }> = ({ app }) => {
    const isAnAppInProgress = useLauncherSelector(getIsAnAppInProgress);

    if (!app.isInstalled) return null;

    return (
        <Dropdown.Item
            disabled={isAnAppInProgress}
            title="Create a desktop shortcut for this app"
            onClick={() => createDesktopShortcut(app)}
        >
            Create shortcut
        </Dropdown.Item>
    );
};

export default CreateShortcut;