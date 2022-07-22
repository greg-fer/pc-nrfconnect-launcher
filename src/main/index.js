/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// eslint-disable-next-line strict,lines-around-directive -- because we are not inside a module, using strict is helpful here
'use strict';

// Run this as soon as possible, so it is set up for the other modules to be loaded afterwards
require('./init');

require('@electron/remote/main').initialize();

const {
    Menu,
    ipcMain,
    dialog,
    app: electronApp,
    powerSaveBlocker,
} = require('electron');
const { join } = require('path');

const config = require('./config');
const windows = require('./windows');
const apps = require('./apps');
const { createMenu } = require('./menu');
const loadDevtools = require('./devtools');
const { createTextFile } = require('./fileUtil');
const { downloadToFile } = require('./net');
const { createDesktopShortcut } = require('./createDesktopShortcut');
const settings = require('./settings');
const sources = require('./sources');
const {
    registerHandlerFromMain: registerDownloadToFileHandler,
} = require('../ipc/downloadToFile');
const {
    registerHandlerFromMain: registerCreateDesktopShortcutHandler,
} = require('../ipc/createDesktopShortcut');
const {
    registerGetHandlerFromMain: registerGetSettingHandler,
    registerSetHandlerFromMain: registerSetSettingHandler,
} = require('../ipc/settings');
const {
    registerHandlerFromMain: registerProxyLoginCredentialsHandler,
} = require('../ipc/proxyLogin');
const { callRegisteredCallback } = require('./proxyLogins');
const {
    registerCheckForUpdateHandlerFromMain: registerCheckForUpdateHandler,
    registerStartUpdateHandlerFromMain: registerStartUpdateHandler,
    registerCancelUpdateHandlerFromMain: registerCancelUpdateHandler,
} = require('../ipc/launcherUpdate');
const { checkForUpdate, startUpdate, cancelUpdate } = require('./autoUpdate');
const {
    registerDownloadAllAppsJsonFilesHandlerFromMain:
        registerDownloadAllAppsJsonFilesHandler,
    registerGetLocalAppsHandlerFromMain: registerGetLocalAppsHandler,
    registerGetOfficialAppsHandlerFromMain: registerGetOfficialAppsHandler,
    registerDownloadReleaseNotesHandlerFromMain:
        registerDownloadReleaseNotesHandler,
    registerInstallOfficialAppHandlerFromMain:
        registerInstallOfficialAppHandler,
    registerRemoveOfficialAppHandlerFromMain: registerRemoveOfficialAppHandler,
} = require('../ipc/apps');
const {
    registerGetHandlerFromMain: registerGetSourcesHandler,
    registerAddHandlerFromMain: registerAddSourceHandler,
    registerRemoveHandlerFromMain: registerRemoveSourceHandler,
} = require('../ipc/sources');

// Ensure that nRFConnect runs in a directory where it has permission to write
process.chdir(electronApp.getPath('temp'));

const { logger } = require('./log');

global.homeDir = config.getHomeDir();
global.userDataDir = config.getUserDataDir();
global.appsRootDir = config.getAppsRootDir();

const applicationMenu = Menu.buildFromTemplate(createMenu(electronApp));

electronApp.allowRendererProcessReuse = false;

electronApp.on('ready', () => {
    loadDevtools();

    Menu.setApplicationMenu(applicationMenu);
    apps.initAppsDirectory()
        .then(() => {
            if (config.getOfficialAppName()) {
                return windows.openOfficialAppWindow(
                    config.getOfficialAppName(),
                    config.getSourceName()
                );
            }
            if (config.getLocalAppName()) {
                return windows.openLocalAppWindow(config.getLocalAppName());
            }
            return windows.openLauncherWindow();
        })
        .catch(error => {
            dialog.showMessageBox(
                {
                    type: 'error',
                    title: 'Initialization error',
                    message: 'Error when starting application',
                    detail: error.message,
                    buttons: ['OK'],
                },
                () => electronApp.quit()
            );
        });
});

electronApp.on('render-process-gone', (event, wc, details) => {
    logger.error(`Renderer crashed ${wc.browserWindowOptions.title}`, details);
});

electronApp.on('child-process-gone', (event, details) => {
    logger.error(`Child process crashed `, details);
});

electronApp.on('window-all-closed', () => {
    electronApp.quit();
});

ipcMain.on('open-app-launcher', () => {
    windows.openLauncherWindow();
});

ipcMain.on('open-app', (event, app) => {
    windows.openAppWindow(app);
});

ipcMain.on('show-about-dialog', event => {
    const appWindow = windows.getAppWindow(event.sender);
    if (appWindow) {
        const { app } = appWindow;
        const detail =
            `${app.description}\n\n` +
            `Version: ${app.currentVersion}\n` +
            `Official: ${app.isOfficial}\n` +
            `Supported engines: nRF Connect for Desktop ${app.engineVersion}\n` +
            `Current engine: nRF Connect for Desktop ${config.getVersion()}\n` +
            `App directory: ${app.path}`;
        dialog.showMessageBox(
            appWindow.browserWindow,
            {
                type: 'info',
                title: 'About',
                message: `${app.displayName || app.name}`,
                detail,
                icon: app.iconPath
                    ? app.iconPath
                    : `${config.getElectronResourcesDir()}/icon.png`,
                buttons: ['OK'],
            },
            () => {}
        );
    }
});

ipcMain.on('get-app-details', event => {
    const appWindow = windows.getAppWindow(event.sender);
    if (appWindow) {
        event.sender.send('app-details', {
            coreVersion: config.getVersion(),
            corePath: config.getElectronRootPath(),
            homeDir: config.getHomeDir(),
            tmpDir: config.getTmpDir(),
            bundledJlink: config.getBundledJlinkVersion(),
            ...appWindow.app,
        });
    }
});

ipcMain.handle('prevent-sleep-start', () =>
    powerSaveBlocker.start('prevent-app-suspension')
);

ipcMain.on('preventing-sleep-end', (_, id) =>
    powerSaveBlocker.stop(Number(id))
);

registerDownloadToFileHandler(downloadToFile);
registerCreateDesktopShortcutHandler(createDesktopShortcut);

registerGetSettingHandler(settings.get);
registerSetSettingHandler(settings.set);

registerProxyLoginCredentialsHandler(callRegisteredCallback);

registerCheckForUpdateHandler(checkForUpdate);
registerStartUpdateHandler(startUpdate);
registerCancelUpdateHandler(cancelUpdate);

registerDownloadAllAppsJsonFilesHandler(apps.downloadAllAppsJsonFiles);
registerGetLocalAppsHandler(apps.getLocalApps);
registerGetOfficialAppsHandler(apps.getOfficialApps);
registerDownloadReleaseNotesHandler(apps.downloadReleaseNotes);
registerInstallOfficialAppHandler(apps.installOfficialApp);
registerRemoveOfficialAppHandler(apps.removeOfficialApp);

registerGetSourcesHandler(sources.getAllSources);
registerAddSourceHandler(sources.addSource);
registerRemoveSourceHandler(sources.removeSource);

/**
 * Let's store the full path to the executable if nRFConnect was started from a built package.
 * This execPath is stored in a known location, so e.g. VS Code extension can launch it even on
 * Linux where there's no standard installation location.
 */
if (electronApp.isPackaged) {
    createTextFile(
        join(global.userDataDir, 'execPath'),
        process.platform === 'linux' && process.env.APPIMAGE
            ? process.env.APPIMAGE
            : process.execPath
    ).catch(err => console.log(err.message));
}
