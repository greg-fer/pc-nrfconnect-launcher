/*
 * Copyright (c) 2022 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { getCurrentWindow, require as remoteRequire } from '@electron/remote';
import { join } from 'path';
import { ErrorDialogActions } from 'pc-nrfconnect-shared';

import {
    AppSpec,
    AppWithError,
    DownloadableApp,
    downloadReleaseNotes,
    getDownloadableApps,
    getLocalApps,
    installDownloadableApp as installDownloadableAppInMain,
    LaunchableApp,
    removeDownloadableApp as removeDownloadableAppInMain,
} from '../../../ipc/apps';
import { downloadToFile } from '../../../ipc/downloadToFile';
import { openApp } from '../../../ipc/openWindow';
import { getAppsRootDir } from '../../../main/config';
import type { AppDispatch } from '../../store';
import appCompatibilityWarning from '../../util/appCompatibilityWarning';
import mainConfig from '../../util/mainConfig';
import {
    EventAction,
    sendAppUsageData,
    sendLauncherUsageData,
} from '../usageData/usageDataEffects';
import {
    installDownloadableAppStarted,
    installDownloadableAppSuccess,
    loadDownloadableAppsError,
    loadDownloadableAppsStarted,
    loadLocalAppsError,
    loadLocalAppsStarted,
    loadLocalAppsSuccess,
    removeDownloadableAppStarted,
    removeDownloadableAppSuccess,
    resetAppProgress,
    setAppIconPath,
    setAppReleaseNote,
    showConfirmLaunchDialog,
    updateAllDownloadableApps,
    updateDownloadableApp,
    upgradeDownloadableAppStarted,
    upgradeDownloadableAppSuccess,
} from './appsSlice';

const fs = remoteRequire('fs-extra');

const downloadAppIcon =
    (app: AppSpec, iconUrl: string, iconPath: string) =>
    (dispatch: AppDispatch) => {
        // If there is a cached version, use it even before downloading.
        if (fs.existsSync(iconPath)) {
            dispatch(setAppIconPath({ app, iconPath }));
        }
        downloadToFile(iconUrl, iconPath)
            .then(() => dispatch(setAppIconPath({ app, iconPath })))
            .catch(() => {
                /* Ignore 404 not found. */
            });
    };

export const loadLocalApps = () => (dispatch: AppDispatch) => {
    dispatch(loadLocalAppsStarted());

    return getLocalApps()
        .then(apps => dispatch(loadLocalAppsSuccess(apps)))
        .catch(error => {
            dispatch(loadLocalAppsError());
            dispatch(ErrorDialogActions.showDialog(error.message));
        });
};

const downloadSingleReleaseNotes = async (
    dispatch: AppDispatch,
    app: DownloadableApp
) => {
    const releaseNote = await downloadReleaseNotes(app);
    if (releaseNote != null) {
        dispatch(setAppReleaseNote({ app, releaseNote }));
    }
};

export const fetchInfoForAllDownloadableApps =
    () => async (dispatch: AppDispatch) => {
        dispatch(loadDownloadableAppsStarted());
        const { apps, appsWithErrors } = await getDownloadableApps();

        dispatch(updateAllDownloadableApps(apps));

        apps.filter(app => !app.isInstalled).forEach(app => {
            const iconPath = join(
                `${getAppsRootDir(app.source, mainConfig())}`,
                `${app.name}.svg`
            );
            const iconUrl = `${app.url}.svg`;
            dispatch(downloadAppIcon(app, iconUrl, iconPath));
        });

        apps.forEach(app => downloadSingleReleaseNotes(dispatch, app));

        if (appsWithErrors.length > 0) {
            handleAppsWithErrors(dispatch, appsWithErrors);
        }
    };

export const fetchInfoForSingleDownloadableApp =
    (appToUpdate: AppSpec) => async (dispatch: AppDispatch) => {
        dispatch(loadDownloadableAppsStarted());
        const { apps } = await getDownloadableApps();

        const updatedApp = apps.find(
            app =>
                app.source === appToUpdate.source &&
                app.name === appToUpdate.name
        );

        if (updatedApp != null) {
            dispatch(updateDownloadableApp(updatedApp));
            downloadSingleReleaseNotes(dispatch, updatedApp);
        } else {
            dispatch(loadDownloadableAppsError());
            console.error(
                `No app ${appToUpdate} found in the fought app infos though there is supposed to be one.`
            );
        }
    };

const handleAppsWithErrors = (dispatch: AppDispatch, apps: AppWithError[]) => {
    dispatch(loadDownloadableAppsError());
    apps.forEach(app => {
        sendLauncherUsageData(
            EventAction.REPORT_INSTALLATION_ERROR,
            `${app.source} - ${app.name}`
        );
    });

    const recover = (invalidPaths: string[]) => () => {
        invalidPaths.forEach(p => fs.remove(p));
        getCurrentWindow().reload();
    };

    dispatch(
        ErrorDialogActions.showDialog(buildErrorMessage(apps), {
            Recover: recover(apps.map(app => app.path)),
            Close: () => dispatch(ErrorDialogActions.hideDialog()),
        })
    );
};

const buildErrorMessage = (apps: AppWithError[]) => {
    const errors = apps.map(app => `* \`${app.reason}\`\n\n`).join('');
    const paths = apps.map(app => `* *${app.path}*\n\n`).join('');
    return `Unable to load all apps, these are the error messages:\n\n${errors}Clicking **Recover** will attempt to remove the following broken installation directories:\n\n${paths}`;
};

export const installDownloadableApp =
    (app: AppSpec) => (dispatch: AppDispatch) => {
        sendAppUsageData(EventAction.INSTALL_APP, app.source, app.name);
        dispatch(installDownloadableAppStarted(app));

        installDownloadableAppInMain(app, 'latest')
            .then(() => {
                dispatch(installDownloadableAppSuccess(app));
                dispatch(fetchInfoForSingleDownloadableApp(app));
            })
            .catch(error => {
                dispatch(resetAppProgress(app));
                dispatch(
                    ErrorDialogActions.showDialog(
                        `Unable to install: ${error.message}`
                    )
                );
            });
    };

export const removeDownloadableApp =
    (app: AppSpec) => (dispatch: AppDispatch) => {
        sendAppUsageData(EventAction.REMOVE_APP, app.source, app.name);
        dispatch(removeDownloadableAppStarted(app));
        removeDownloadableAppInMain(app)
            .then(() => {
                dispatch(removeDownloadableAppSuccess(app));
            })
            .catch(error => {
                dispatch(resetAppProgress(app));
                dispatch(
                    ErrorDialogActions.showDialog(
                        `Unable to remove: ${error.message}`
                    )
                );
            });
    };

export const upgradeDownloadableApp =
    (app: AppSpec, version: string) => (dispatch: AppDispatch) => {
        sendAppUsageData(EventAction.UPGRADE_APP, app.source, app.name);
        dispatch(upgradeDownloadableAppStarted(app));

        return installDownloadableAppInMain(app, version)
            .then(() => {
                dispatch(upgradeDownloadableAppSuccess(app));
                dispatch(fetchInfoForSingleDownloadableApp(app));
            })
            .catch(error => {
                dispatch(resetAppProgress(app));
                dispatch(
                    ErrorDialogActions.showDialog(
                        `Unable to upgrade: ${error.message}`
                    )
                );
            });
    };

export const launch = (app: LaunchableApp) => {
    const sharedData =
        `App version: ${app.currentVersion};` +
        ` Engine version: ${app.engineVersion};`;
    sendAppUsageData(EventAction.LAUNCH_APP, sharedData, app.name);
    openApp(app);
};

export const checkEngineAndLaunch =
    (app: LaunchableApp) => (dispatch: AppDispatch) => {
        const compatibilityWarning = appCompatibilityWarning(app);
        const launchAppWithoutWarning =
            compatibilityWarning == null ||
            mainConfig().isRunningLauncherFromSource;

        if (launchAppWithoutWarning) {
            launch(app);
        } else {
            dispatch(
                showConfirmLaunchDialog({
                    app,
                    text: compatibilityWarning.longWarning,
                })
            );
        }
    };