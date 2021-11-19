/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { ElectronApplication, expect, Page, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import launchFirstApp from '../launchFirstApp';
import { setup, teardown } from '../setupTestApp';

const oldPath = path.join(__dirname, '../../', 'README.md');
const newPath = path.join(__dirname, '../../', 'README.md.not');

test.describe(
    'checks the version of the engine against what the app declares',
    () => {
        test.describe('an official app that is only available', () => {
            const appsRootDir =
                'launcher/fixtures/one-official-app-not-installed/.nrfconnect-apps';
            let app: ElectronApplication;
            let page: Page;
            test.beforeAll(async () => {
                app = await setup({
                    appsRootDir,
                });

                page = await app.firstWindow();
            });

            test.afterAll(async () => {
                await teardown({
                    app,
                    appsRootDir,
                });
            });

            test('shows no warning in the app list', async () => {
                await page.waitForSelector('.list-group-item');

                await expect(
                    page.$(
                        '[title*="The app does not specify which nRF Connect version(s) it supports"]'
                    )
                ).resolves.toBeNull();
                await expect(
                    page.$('[title*="The app only supports nRF Connect"]')
                ).resolves.toBeNull();
            });
        });

        test.describe('local app with unsupported engine', () => {
            const appsRootDir =
                'launcher/fixtures/one-local-app-unsupported-engine/.nrfconnect-apps';
            let app: ElectronApplication;
            let page: Page;
            test.beforeAll(async () => {
                fs.renameSync(oldPath, newPath);
                app = await setup({
                    appsRootDir,
                });

                page = await app.firstWindow();
            });

            test.afterAll(async () => {
                await teardown({
                    app,
                    appsRootDir,
                });
                fs.renameSync(newPath, oldPath);
            });

            test('shows a warning in the app list', async () => {
                await page.waitForSelector('.list-group-item');
                await expect(
                    page.$('[title*="The app only supports nRF Connect 1.x"]')
                ).resolves.not.toBeNull();
            });

            test('shows a warning dialog when launching the app', async () => {
                await launchFirstApp(app);
                await expect(page.$('.modal-content')).resolves.not.toBeNull();
            });
        });

        test.describe('one local app without engine definition', () => {
            const appsRootDir =
                'launcher/fixtures/one-local-app-without-engine/.nrfconnect-apps';
            let app: ElectronApplication;
            let page: Page;
            test.beforeAll(async () => {
                fs.renameSync(oldPath, newPath);
                app = await setup({
                    appsRootDir,
                });

                page = await app.firstWindow();
            });

            test.afterAll(async () => {
                await teardown({
                    app,
                    appsRootDir,
                });
                fs.renameSync(newPath, oldPath);
            });

            test('shows a warning in the app list', async () => {
                await page.waitForSelector('.list-group-item');

                await expect(
                    page.$(
                        'span[title*="The app does not specify which nRF Connect version(s) it supports"]'
                    )
                ).resolves.not.toBeNull();
            });

            test('shows a warning dialog when launching the app', async () => {
                await launchFirstApp(app);
                await expect(page.$('.modal-content')).resolves.not.toBeNull();
            });
        });
    }
);
