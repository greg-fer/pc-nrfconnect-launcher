/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint-disable no-bitwise */

const { shell } = require('electron');
const fs = require('fs');
const Mustache = require('mustache');
const path = require('path');
const { v4 } = require('uuid');

const config = require('./config');
const fileUtil = require('./fileUtil');

const { sendFromMain: showErrorDialog } = require('../ipc/errorDialog');

const mode =
    fs.constants.S_IRWXU |
    fs.constants.S_IRGRP |
    fs.constants.S_IXGRP |
    fs.constants.S_IROTH |
    fs.constants.S_IXOTH;

/**
 * Get file name according to app
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {String} file name from app.
 */
function getFileName(app) {
    const appName = `${app.displayName || app.name}`;
    let sourceName = ' (Local)';
    if (app.isOfficial) {
        sourceName = app.source === 'official' ? '' : ` (${app.source})`;
    }
    return `${appName}${sourceName}`;
}

/**
 * Get arguments according to app
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {String} arguments from app.
 */
function getArgs(app) {
    const args = ['--args'];
    if (app.isOfficial) {
        args.push(
            '--open-official-app',
            app.name,
            '--source',
            `"${app.source}"`
        );
    } else {
        args.push('--open-local-app', app.name);
    }
    return args.join(' ');
}

/**
 * Create desktop shortcut on Windows
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {void}
 */
function createShortcutForWindows(app) {
    const fileName = getFileName(app);
    const filePath = path.join(config.getDesktopDir(), `${fileName}.lnk`);
    if (app.shortcutIconPath) {
        const shortcutStatus = shell.writeShortcutLink(filePath, {
            target: config.getElectronExePath(),
            // In Windows, use double quote surrounding arguments
            args: getArgs(app),
            icon: app.shortcutIconPath,
            // iconIndex has to be set to change icon
            iconIndex: 0,
        });
        if (shortcutStatus !== true) {
            showErrorDialog('Fail with shell.writeShortcutLink');
        }
    } else {
        showErrorDialog('Fail to create desktop since app.iconPath is not set');
    }
}

/**
 * Generate shortcut content on Linux
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {string} shortcut content for Linux.
 */
function generateShortcutContent(app) {
    const fileName = getFileName(app);
    const args = getArgs(app);
    let shortcutContent = '[Desktop Entry]\n';
    shortcutContent += 'Encoding=UTF-8\n';
    shortcutContent += `Version=${app.currentVersion}\n`;
    shortcutContent += `Name=${fileName}\n`;
    // In Linux, use single quote surrounding arguments
    shortcutContent += `Exec=${config.getElectronExePath()} ${args}\n`;
    shortcutContent += 'Terminal=false\n';
    const { iconPath, shortcutIconPath } = app;
    shortcutContent += `Icon=${shortcutIconPath || iconPath}\n`;
    shortcutContent += 'Type=Application\n';
    if (!fileName || !args) {
        return null;
    }
    return shortcutContent;
}

/**
 * Create desktop shortcut on Linux
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {void}
 */
function createShortcutForLinux(app) {
    const fileName = getFileName(app);
    const desktopFilePath = path.join(
        config.getDesktopDir(),
        `${fileName}.desktop`
    );
    const applicationsFilePath = path.join(
        config.getUbuntuDesktopDir(),
        `${fileName}.desktop`
    );
    const shortcutContent = generateShortcutContent(app);
    if (!shortcutContent) {
        showErrorDialog(
            'Fail to create desktop shortcut since the shortcut content is empty'
        );
        return;
    }

    try {
        fs.writeFileSync(desktopFilePath, shortcutContent);
        fs.chmodSync(desktopFilePath, mode);
        fs.writeFileSync(applicationsFilePath, shortcutContent);
        fs.chmodSync(applicationsFilePath, mode);
    } catch (err) {
        showErrorDialog(
            `Fail to create desktop shortcut on Linux with error: ${err}`
        );
    }
}

/**
 * Create desktop shortcut on MacOS
 * Template is located at /resources/mac/template.app.
 * Copy this template to a tmp folder first.
 * Change the content inside.
 * Copy the modified one to launchpad and desktop.
 * Change the mode of binary file to executable.
 *
 * Copying template to a tmp folder first is to avoid icon cache on MacOS.
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {void}
 */
async function createShortcutForMacOS(app) {
    const fileName = getFileName(app);
    let filePath = path.join(config.getDesktopDir(), `${fileName}.app`);
    const templateName = `template-${v4()}.app`;
    const appTemplateTarPath = path.join(
        config.getElectronRootPath(),
        '/resources/mac/template.tar.gz'
    );
    const tmpAppPath = path.join(
        config.getTmpDir(),
        '/com.nordicsemi.nrfconnect'
    );
    const tmpAppTemplatePath = path.join(tmpAppPath, templateName);
    const appExecPath = path.join(filePath, '/Contents/MacOS/Application Stub');
    const icnsPath = path.join(
        tmpAppTemplatePath,
        '/Contents/Resources/icon.icns'
    );

    try {
        // Untar template
        await fileUtil.untar(appTemplateTarPath, tmpAppTemplatePath, 1);
        await fileUtil.chmodDir(tmpAppTemplatePath, mode);

        // Create Info.plist
        const infoTmpPath = path.join(
            tmpAppTemplatePath,
            '/Contents/Info.plist'
        );
        const identifier = `com.nordicsemi.nrfconnect.${app.name}${
            app.isOfficial ? '' : '-local'
        }`;
        const infoContentSource = fs.readFileSync(infoTmpPath, 'UTF-8');
        Mustache.parse(infoContentSource);
        const infoContentData = {
            identifier,
            fileName,
        };
        const infoContent = Mustache.render(infoContentSource, infoContentData);

        // Create document.wflow
        const wflowTmpPath = path.join(
            tmpAppTemplatePath,
            '/Contents/document.wflow'
        );
        // In MacOS spaces should be replaced
        const shortcutCMD = `${config
            .getElectronExePath()
            .replace(/ /g, '\\ ')} ${getArgs(app)}`;
        const wflowContentSource = fs.readFileSync(wflowTmpPath, 'UTF-8');
        Mustache.parse(wflowContentSource);
        const wflowContentData = {
            shortcutCMD,
        };
        const wflowContent = Mustache.render(
            wflowContentSource,
            wflowContentData
        );

        await fileUtil.createTextFile(infoTmpPath, infoContent);
        await fileUtil.createTextFile(wflowTmpPath, wflowContent);
        await fileUtil.copy(app.shortcutIconPath, icnsPath);

        // Copy to Desktop
        await fileUtil.copy(tmpAppTemplatePath, filePath);

        // Copy to Applications
        filePath = path.join(
            config.getHomeDir(),
            `/Applications/${fileName}.app/`
        );
        await fileUtil.copy(tmpAppTemplatePath, filePath);

        // Change mode
        await fileUtil.chmodDir(appExecPath, mode);
    } catch (error) {
        showErrorDialog(
            `Error occured while creating desktop shortcut on MacOS with error: ${error}`
        );
    }
}

/**
 * Create desktop shortcut
 *
 * @param {Object} app, create desktop shortcut for which app.
 * @returns {Function} dispatch, dispatch action in Redux.
 */
function createDesktopShortcut(app) {
    switch (process.platform) {
        case 'win32':
            createShortcutForWindows(app);
            break;
        case 'linux':
            createShortcutForLinux(app);
            break;
        case 'darwin':
            createShortcutForMacOS(app);
            break;
        default:
            showErrorDialog(
                'Your operating system is neither Windows, Linux, nor macOS'
            );
    }
}

module.exports = { createDesktopShortcut };
