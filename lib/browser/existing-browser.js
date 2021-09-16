'use strict';

const Promise = require('bluebird');
const {clientBridge, browser: {Camera}} = require('gemini-core');
const _ = require('lodash');
const url = require('url');
const Browser = require('./browser');
const commandsList = require('./commands');
const logger = require('../utils/logger');

module.exports = class ExistingBrowser extends Browser {
    static create(config, id, version, emitter, sessionOpts) {
        return new this(config, id, version, emitter, sessionOpts);
    }

    constructor(config, id, version, emitter, sessionOpts) {
        super(config, id, version, sessionOpts);

        this._emitter = emitter;
        this._camera = Camera.create(this._config.screenshotMode, () => this._takeScreenshot());

        this._meta = this._initMeta();
    }

    _initMeta() {
        return {
            pid: process.pid,
            browserVersion: this.version,
            ...this._config.meta
        };
    }

    _takeScreenshot() {
        return this._session.screenshot().then(({value}) => value);
    }

    _addCommands() {
        this._addMetaAccessCommands(this._session);
        this._decorateUrlMethod(this._session);

        commandsList.forEach((command) => require(`./commands/${command}`)(this));

        super._addCommands();
    }

    _addMetaAccessCommands(session) {
        session.addCommand('setMeta', (key, value) => this._meta[key] = value);
        session.addCommand('getMeta', (key) => key ? this._meta[key] : this._meta);
    }

    _decorateUrlMethod(session) {
        const baseUrlFn = session.url.bind(session);

        session.addCommand('url', async (uri) => {
            if (!uri) {
                return baseUrlFn(uri);
            }

            const newUri = this._resolveUrl(uri);
            this._meta.url = newUri;

            if (this._config.urlHttpTimeout) {
                this.setHttpTimeout(this._config.urlHttpTimeout);
            }

            let result = await baseUrlFn(newUri);
            if (this._config.urlHttpTimeout) {
                this.restoreHttpTimeout();
            }

            return this._clientBridge ? this._clientBridge.call('resetZoom').then(() => result) : result;
        }, true); // overwrite original `url` method
    }

    _resolveUrl(uri) {
        return this._config.baseUrl ? url.resolve(this._config.baseUrl, uri) : uri;
    }

    async init(sessionId, calibrator) {
        try {
            this.config.prepareBrowser && this.config.prepareBrowser(this.publicAPI);
        } catch (e) {
            logger.warn(`WARN: couldn't prepare browser ${this.id}\n`, e.stack);
        }

        await this._prepareSession(sessionId);
        await this._performCalibration(calibrator);
        await this._buildClientScripts();

        return this;
    }

    async reinit(sessionId, sessionOpts) {
        this._session.extendOptions(sessionOpts);
        await this._prepareSession(sessionId);

        return this;
    }

    async _prepareSession(sessionId) {
        await this._attach(sessionId);
        await this._setOrientation(this.config.orientation);
        await this._setWindowSize(this.config.windowSize);
    }

    async _setOrientation(orientation) {
        if (orientation) {
            await this._session.setOrientation(orientation);
        }
    }

    async _setWindowSize(size) {
        if (size) {
            await this._session.windowHandleSize(size);
        }
    }

    _performCalibration(calibrator) {
        if (!this.config.calibrate || this._calibration) {
            return Promise.resolve();
        }

        return calibrator.calibrate(this)
            .then((calibration) => {
                this._calibration = calibration;
                this._camera.calibrate(calibration);
            });
    }

    _buildClientScripts() {
        return clientBridge.build(this, {calibration: this._calibration})
            .then((clientBridge) => this._clientBridge = clientBridge);
    }

    _attach(sessionId) {
        this.sessionId = sessionId;

        return Promise.resolve();
    }

    _stubCommands() {
        for (let commandName in this._session) {
            if (['addCommand', 'end', 'session'].includes(commandName)) {
                continue;
            }

            this._session.addCommand(commandName, () => {}, true);
        }
    }

    markAsBroken() {
        this.applyState({isBroken: true});

        this._stubCommands();
    }

    quit() {
        this.sessionId = null;
        this._session.commandList.splice(0);
        this._meta = this._initMeta();
        this._state = {isBroken: false};
    }

    async prepareScreenshot(selectors, opts = {}) {
        opts = _.extend(opts, {
            usePixelRatio: this._calibration ? this._calibration.usePixelRatio : true
        });

        const result = await this._clientBridge.call('prepareScreenshot', [selectors, opts]);
        if (result.error) {
            throw new Error(`Prepare screenshot failed with error type '${result.error}' and error message: ${result.message}`);
        }
        return result;
    }

    open(url) {
        return this._session.url(url);
    }

    evalScript(script) {
        return this._session.execute(`return ${script}`).then(({value}) => value);
    }

    injectScript(script) {
        return this._session.execute(script);
    }

    async captureViewportImage(page, screenshotDelay) {
        if (screenshotDelay) {
            await Promise.delay(screenshotDelay);
        }

        return this._camera.captureViewportImage(page);
    }

    scrollBy(x, y) {
        const script = `return window.scrollTo(window.pageXOffset+${x},window.pageYOffset+${y});`;
        return this._session.execute(script).then(({value}) => value);
    }

    get meta() {
        return this._meta;
    }

    get emitter() {
        return this._emitter;
    }
};
