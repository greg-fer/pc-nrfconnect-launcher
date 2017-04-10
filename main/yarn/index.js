/* Copyright (c) 2015 - 2017, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Use in source and binary forms, redistribution in binary form only, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions in binary form, except as embedded into a Nordic
 *    Semiconductor ASA integrated circuit in a product or a software update for
 *    such product, must reproduce the above copyright notice, this list of
 *    conditions and the following disclaimer in the documentation and/or other
 *    materials provided with the distribution.
 *
 * 2. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * 3. This software, with or without modification, must only be used with a Nordic
 *    Semiconductor ASA integrated circuit.
 *
 * 4. Any software provided in binary form under this license must not be reverse
 *    engineered, decompiled, modified and/or disassembled.
 *
 * THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const fork = require('child_process').fork;
const parseOutdated = require('./parsing').parseOutdated;
const config = require('../config') ;

const yarnPath = require.resolve('yarn/bin/yarn.js');

function yarn(args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = fork(yarnPath, args, Object.assign({}, options, {
            cwd: config.getAppsRootDir(),
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        }));

        let buffer = '';
        const addToBuffer = data => {
            buffer += data.toString();
        };
        proc.stdout.on('data', data => addToBuffer(data));
        proc.stderr.on('data', data => addToBuffer(data));

        proc.on('exit', code => (
            code !== 0 ? reject(new Error(buffer)) : resolve(buffer)
        ));
        proc.on('error', err => (
            reject(new Error(`Error when running yarn: ${err.message}`))
        ));
    });
}

/**
 * Installs the given npm package in the apps root directory. The package
 * is added as an exact dependency in package.json in the same directory.
 * The name can optionally have a version, e.g. 'package@1.2.3'.
 *
 * @param {string} name The name of the package to install.
 * @returns {Promise} Promise that resolves or rejects with the yarn output.
 */
function add(name) {
    return yarn(['add', '--exact', name]);
}

/**
 * Uninstalls the given npm package in the apps root directory. The package
 * is removed from the list of dependencies in package.json in the same
 * directory.
 *
 * @param {string} name The name of the package to remove.
 * @returns {Promise} Promise that resolves or rejects with the yarn output.
 */
function remove(name) {
    return yarn(['remove', name]);
}

/**
 * Returns packages that have outdated versions. A promise is returned,
 * which resolves with an object containing package names as keys and
 * their latest version as values.
 *
 * If no outdated packages are found, the promise will resolve with an
 * empty object.
 *
 * @returns {Promise} Promise that resolves with an object of packages.
 */
function outdated() {
    return yarn(['outdated'])
        .then(output => parseOutdated(output));
}

module.exports = {
    add,
    remove,
    outdated,
};