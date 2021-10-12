'use strict';

const {EventEmitter} = require('events');
const {passthroughEvent} = require('gemini-core').events.utils;
const SetsBuilder = require('gemini-core').SetsBuilder;
const TestParser = require('./mocha-test-parser');
const TestSkipper = require('./test-skipper');
const Events = require('../constants/runner-events');
const env = require('../utils/env');

module.exports = class TestReader extends EventEmitter {
    static create(...args) {
        return new this(...args);
    }

    constructor(config) {
        super();

        this._config = config;
        this._testSkipper = TestSkipper.create(this._config);
    }

    async read({paths, browsers, ignore, sets, grep} = {}) {
        const {fileExtensions} = this._config.system;
        const setCollection = await SetsBuilder
            .create(this._config.sets, {defaultDir: require('../../package').name})
            .useFiles(paths)
            .useSets((sets || []).concat(env.parseCommaSeparatedValue('HERMIONE_SETS')))
            .useBrowsers(browsers)
            .build(process.cwd(), {ignore}, fileExtensions);

        TestParser.prepare();

        const filesByBro = setCollection.groupByBrowser();

        return Object.fromEntries(await Promise.all(
            Object.entries(filesByBro)
                .map(([browserId, files]) => [browserId, {files, parser: this._makeParser(browserId, grep)}])
                .map(async ([browserId, {files, parser}]) => {
                    await parser.loadFiles(files);
                    return [browserId, parser.parse()];
                })
        ));
    }

    _makeParser(browserId, grep) {
        const parser = TestParser.create(browserId, this._config);

        passthroughEvent(parser, this, [
            Events.BEFORE_FILE_READ,
            Events.AFTER_FILE_READ
        ]);

        return parser
            .applySkip(this._testSkipper)
            .applyConfigController()
            .applyGrep(grep);
    }
};
