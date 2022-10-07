/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';

import { App as AppType } from '../../../ipc/apps';
import WithScrollbarContainer from '../../containers/WithScrollbarContainer';
import { useLauncherSelector } from '../../util/hooks';
import AppFilterBar from '../filter/AppFilterBar';
import { getAppsFilter } from '../filter/filterSlice';
import ReleaseNotesDialog from '../releaseNotes/ReleaseNotesDialog';
import App from './App';
import { getAllApps, getAppsInProgress } from './appsSlice';

const sortByStateAndName = (appA: AppType, appB: AppType) => {
    const cmpInstalled =
        Number(!!appB.currentVersion) - Number(!!appA.currentVersion);

    const aName = appA.displayName || appA.name;
    const bName = appB.displayName || appB.name;

    return cmpInstalled || aName.localeCompare(bName);
};

export default () => {
    const { installingAppName, removingAppName, upgradingAppName } =
        useLauncherSelector(getAppsInProgress);
    const isProcessing =
        installingAppName != null ||
        upgradingAppName != null ||
        removingAppName != null;

    const allApps = useLauncherSelector(getAllApps);
    const appsFilter = useLauncherSelector(getAppsFilter);

    const apps = allApps.filter(appsFilter).sort(sortByStateAndName);

    return (
        <>
            <AppFilterBar />
            <WithScrollbarContainer hasFilter>
                {apps.map(app => (
                    <App
                        key={`${app.name}-${app.source}`}
                        app={app}
                        isDisabled={isProcessing}
                    />
                ))}
            </WithScrollbarContainer>

            <ReleaseNotesDialog />
        </>
    );
};
