'use strict';

const {EventEmitter} = require('events');
const _ = require('lodash');
const fs = require('fs-extra');
const webdriverio = require('webdriverio');
const {Image, temp, ScreenShooter, clientBridge} = require('gemini-core');
const AssertViewError = require('lib/browser/commands/assert-view/errors/assert-view-error');
const ImageDiffError = require('lib/browser/commands/assert-view/errors/image-diff-error');
const NoRefImageError = require('lib/browser/commands/assert-view/errors/no-ref-image-error');
const RuntimeConfig = require('lib/config/runtime-config');
const updateRefs = require('lib/browser/commands/assert-view/capture-processors/update-refs');
const {mkExistingBrowser_: mkBrowser_, mkSessionStub_} = require('../../utils');

describe('assertView command', () => {
    const sandbox = sinon.sandbox.create();

    const mkConfig_ = (opts = {}) => {
        return Object.assign({
            getScreenshotPath: () => '/some/path',
            system: {
                diffColor: '#ffffff',
                tempOpts: {}
            }
        }, opts);
    };

    const stubImage_ = (opts = {}) => {
        opts = _.defaults(opts, {
            size: {width: 100500, height: 500100}
        });

        return {
            save: sandbox.stub().named('save'),
            getSize: sandbox.stub().named('getSize').returns(opts.size)
        };
    };

    const stubBrowser_ = (config) => {
        const session = mkSessionStub_();
        session.executionContext = {hermioneCtx: {}};
        sandbox.stub(webdriverio, 'attach').resolves(session);
        sandbox.stub(clientBridge, 'build').resolves();

        const browser = mkBrowser_(config);
        sandbox.stub(browser, 'prepareScreenshot').resolves({});
        sandbox.stub(browser, 'captureViewportImage').resolves(stubImage_());
        sandbox.stub(browser, 'emitter').get(() => new EventEmitter());

        return browser;
    };

    beforeEach(() => {
        sandbox.stub(Image, 'create').returns(Object.create(Image.prototype));
        sandbox.stub(Image, 'compare').resolves(true);
        sandbox.stub(Image.prototype, 'getSize');

        sandbox.stub(fs, 'readFileSync');
        sandbox.stub(fs, 'existsSync').returns(true);

        sandbox.stub(temp, 'path');
        sandbox.stub(temp, 'attach');

        sandbox.stub(RuntimeConfig, 'getInstance').returns({tempOpts: {}});

        sandbox.spy(ScreenShooter, 'create');
        sandbox.stub(ScreenShooter.prototype, 'capture').resolves(stubImage_());

        sandbox.stub(updateRefs, 'handleNoRefImage').resolves();
        sandbox.stub(updateRefs, 'handleImageDiff').resolves();
    });

    afterEach(() => sandbox.restore());

    it('should fail on duplicate name of the state', async () => {
        const browser = await stubBrowser_().init();

        await browser.publicAPI.assertView('plain');

        try {
            await browser.publicAPI.assertView('plain');
        } catch (e) {
            assert.instanceOf(e, AssertViewError);
            assert.equal(e.message, 'duplicate name for "plain" state');
        }
    });

    describe('prepare screenshot', () => {
        it('should prepare screenshot for one selector', async () => {
            const browser = await stubBrowser_().init();

            await browser.publicAPI.assertView('plain', '.selector');

            assert.calledOnceWith(browser.prepareScreenshot, ['.selector']);
        });

        it('should prepare screenshot for several selectors', async () => {
            const browser = await stubBrowser_().init();

            await browser.publicAPI.assertView('plain', ['.selector1', '.selector2']);

            assert.calledOnceWith(browser.prepareScreenshot, ['.selector1', '.selector2']);
        });

        describe('should prepare screenshot with ignore elements', () => {
            [
                {
                    name: 'array',
                    ignoreElements: ['.foo', '#bar'],
                    ignoreSelectors: ['.foo', '#bar']
                },
                {
                    name: 'string',
                    ignoreElements: '.foo .bar',
                    ignoreSelectors: ['.foo .bar']
                }
            ].forEach(({name, ignoreElements, ignoreSelectors}) => {
                it(`passed as ${name} using "assertView" options`, async () => {
                    const browser = await stubBrowser_().init();

                    await browser.publicAPI.assertView(null, null, {ignoreElements});

                    assert.calledOnceWith(
                        browser.prepareScreenshot, sinon.match.any, sinon.match({ignoreSelectors})
                    );
                });
            });

            it('from config option "assertViewOpts"', async () => {
                const config = mkConfig_({assertViewOpts: {ignoreElements: ['foo', 'bar']}});
                const browser = await stubBrowser_(config).init();

                await browser.publicAPI.assertView();

                assert.calledOnceWith(
                    browser.prepareScreenshot, sinon.match.any, sinon.match({ignoreSelectors: ['foo', 'bar']})
                );
            });

            it('from "assertView" even if it is set in "assertViewOpts"', async () => {
                const config = mkConfig_({assertViewOpts: {ignoreElements: ['foo', 'bar']}});
                const browser = await stubBrowser_(config).init();

                await browser.publicAPI.assertView(null, null, {ignoreElements: ['baz', 'qux']});

                assert.calledOnceWith(
                    browser.prepareScreenshot, sinon.match.any, sinon.match({ignoreSelectors: ['baz', 'qux']})
                );
            });
        });

        ['allowViewportOverflow', 'captureElementFromTop'].forEach((option) => {
            describe(`should prepare screenshot with "${option}" option`, () => {
                let browser;

                beforeEach(async () => {
                    const config = mkConfig_({assertViewOpts: {[option]: false}});
                    browser = await stubBrowser_(config).init();
                });

                it('from config option "assertViewOpts"', async () => {
                    await browser.publicAPI.assertView();

                    assert.calledOnceWith(
                        browser.prepareScreenshot, sinon.match.any, sinon.match({[option]: false})
                    );
                });

                it('from "assertView" command even if it is set in "assertViewOpts"', async () => {
                    await browser.publicAPI.assertView(null, null, {[option]: true});

                    assert.calledOnceWith(
                        browser.prepareScreenshot, sinon.match.any, sinon.match({[option]: true})
                    );
                });
            });
        });

        describe('should prepare screenshot with "selectorToScroll" option', () => {
            let browser;

            beforeEach(async () => {
                const config = mkConfig_({assertViewOpts: {selectorToScroll: '.selector-1'}});
                browser = await stubBrowser_(config).init();
            });

            it('from config option "assertViewOpts"', async () => {
                await browser.publicAPI.assertView();

                assert.calledOnceWith(
                    browser.prepareScreenshot, sinon.match.any, sinon.match({selectorToScroll: '.selector-1'})
                );
            });

            it('from "assertView" command even if it is set in "assertViewOpts"', async () => {
                await browser.publicAPI.assertView(null, null, {selectorToScroll: '.selector-2'});

                assert.calledOnceWith(
                    browser.prepareScreenshot, sinon.match.any, sinon.match({selectorToScroll: '.selector-2'})
                );
            });
        });
    });

    describe('take screenshot', () => {
        it('should create an instance of a screen shooter', async () => {
            const browser = await stubBrowser_().init();

            assert.calledOnceWith(ScreenShooter.create, browser);
        });

        it('should capture a screenshot image', async () => {
            const browser = await stubBrowser_().init();
            browser.prepareScreenshot.resolves({foo: 'bar'});

            await browser.publicAPI.assertView();

            assert.calledOnceWith(ScreenShooter.prototype.capture, {foo: 'bar'});
        });

        it('should save a captured screenshot', async () => {
            temp.path.returns('/curr/path');

            const browser = await stubBrowser_().init();
            const image = stubImage_();

            ScreenShooter.prototype.capture.resolves(image);

            await browser.publicAPI.assertView();

            assert.calledOnceWith(image.save, '/curr/path');
        });

        [
            {option: 'allowViewportOverflow', configValue: false, passedValue: true},
            {option: 'selectorToScroll', configValue: '.selector-1', passedValue: '.selector-2'}
        ].forEach(({option, configValue, passedValue}) => {
            describe(`should capture screenshot with "${option}" option`, () => {
                let browser;

                beforeEach(async () => {
                    const config = mkConfig_({assertViewOpts: {[option]: configValue}});
                    browser = await stubBrowser_(config).init();
                });

                it('from config option "assertViewOpts"', async () => {
                    await browser.publicAPI.assertView();

                    assert.calledWithMatch(ScreenShooter.prototype.capture, sinon.match.any, {[option]: configValue});
                });

                it('from "assertView" command even if it is set in "assertViewOpts"', async () => {
                    await browser.publicAPI.assertView(null, null, {[option]: passedValue});

                    assert.calledWithMatch(ScreenShooter.prototype.capture, sinon.match.any, {[option]: passedValue});
                });
            });
        });

        ['compositeImage', 'screenshotDelay'].forEach((option) => {
            describe(`should capture screenshot with "${option}" option`, () => {
                it(`from config option "${option}"`, async () => {
                    const config = mkConfig_({[option]: 'value-1'});
                    const browser = await stubBrowser_(config).init();

                    await browser.publicAPI.assertView();

                    assert.calledWithMatch(ScreenShooter.prototype.capture, sinon.match.any, {
                        [option]: 'value-1'
                    });
                });

                it(`from config option "assertViewOpts" even if it is set in "${option}"`, async () => {
                    const config = mkConfig_({
                        [option]: 'value-1',
                        assertViewOpts: {
                            [option]: 'value-2'
                        }
                    });
                    const browser = await stubBrowser_(config).init();

                    await browser.publicAPI.assertView();

                    assert.calledWithMatch(ScreenShooter.prototype.capture, sinon.match.any, {
                        [option]: 'value-2'
                    });
                });

                it(`from "assertView" command even if it is set in "assertViewOpts" and "${option}"`, async () => {
                    const config = mkConfig_({
                        [option]: 'value-1',
                        assertViewOpts: {
                            [option]: 'value-2'
                        }
                    });
                    const browser = await stubBrowser_(config).init();

                    await browser.publicAPI.assertView(null, null, {[option]: 'value-3'});

                    assert.calledWithMatch(ScreenShooter.prototype.capture, sinon.match.any, {
                        [option]: 'value-3'
                    });
                });
            });
        });
    });

    it('should not fail if there is no reference image', async () => {
        fs.existsSync.returns(false);
        const browser = await stubBrowser_().init();

        await assert.isFulfilled(browser.publicAPI.assertView());
    });

    it('should create "NoRefImageError" error with given parameters', async () => {
        sandbox.stub(NoRefImageError, 'create').returns(Object.create(NoRefImageError.prototype));
        fs.existsSync.returns(false);
        temp.path.returns('/curr/path');

        const currImage = stubImage_({size: {width: 100, height: 200}});
        ScreenShooter.prototype.capture.resolves(currImage);

        const browser = await stubBrowser_({getScreenshotPath: () => '/ref/path'}).init();

        await browser.publicAPI.assertView('state');

        assert.calledOnceWith(NoRefImageError.create,
            'state',
            {path: '/curr/path', size: {width: 100, height: 200}},
            {path: '/ref/path', size: null}
        );
    });

    it('should remember several "NoRefImageError" errors', async () => {
        fs.existsSync.returns(false);
        temp.path.returns('/curr/path');

        const browser = await stubBrowser_().init();

        await browser.publicAPI.assertView('foo');
        await browser.publicAPI.assertView('bar');

        const [firstError, secondError] = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get();
        assert.instanceOf(firstError, NoRefImageError);
        assert.instanceOf(secondError, NoRefImageError);
        assert.notEqual(firstError, secondError);
    });

    describe('update refs', () => {
        beforeEach(() => RuntimeConfig.getInstance.returns({updateRefs: true, tempOpts: {}}));

        it('should be fulfilled if there is not reference image', async () => {
            fs.existsSync.returns(false);
            const browser = await stubBrowser_().init();

            await assert.isFulfilled(browser.publicAPI.assertView());
        });

        it('should reject on reference update fail', async () => {
            fs.existsSync.returns(false);
            updateRefs.handleNoRefImage.throws();
            const browser = await stubBrowser_().init();

            await assert.isRejected(browser.publicAPI.assertView());
        });

        it('should pass browser emitter to "handleNoRefImage" handler', async () => {
            fs.existsSync.returns(false);
            const browser = await stubBrowser_().init();

            await browser.publicAPI.assertView();

            assert.calledWith(
                updateRefs.handleNoRefImage,
                sinon.match.any, sinon.match.any, sinon.match.any, {emitter: browser.emitter}
            );
        });
    });

    describe('image compare', () => {
        it('should add opts from runtime config to temp', async () => {
            Image.compare.resolves({equal: true});
            RuntimeConfig.getInstance.returns({tempOpts: {some: 'opts'}});
            const browser = await stubBrowser_().init();

            await browser.publicAPI.assertView();

            assert.calledOnceWith(temp.attach, {some: 'opts', suffix: '.png'});
        });

        it('should compare a current image with a reference', async () => {
            const config = mkConfig_({getScreenshotPath: () => '/ref/path'});
            Image.compare.resolves({equal: true});
            temp.path.returns('/curr/path');
            const browser = await stubBrowser_(config).init();

            await browser.publicAPI.assertView();

            assert.calledOnceWith(Image.compare, '/ref/path', '/curr/path');
        });

        it('should compare images with given set of parameters', async () => {
            const config = mkConfig_({tolerance: 100, antialiasingTolerance: 200, compareOpts: {stopOnFirstFail: true}});
            const browser = await stubBrowser_(config).init();

            browser.prepareScreenshot.resolves({canHaveCaret: 'foo bar', pixelRatio: 300});

            await browser.publicAPI.assertView();

            assert.calledOnceWith(
                Image.compare,
                sinon.match.any, sinon.match.any,
                {canHaveCaret: 'foo bar', tolerance: 100, antialiasingTolerance: 200, pixelRatio: 300, compareOpts: {stopOnFirstFail: true}}
            );
        });

        ['tolerance', 'antialiasingTolerance'].forEach((option) => {
            it(`should compare images with given "${option}"`, async () => {
                const config = mkConfig_({[option]: 100});
                const browser = await stubBrowser_(config).init();

                browser.prepareScreenshot.resolves({});

                await browser.publicAPI.assertView(null, null, {[option]: 500});

                assert.calledOnceWith(
                    Image.compare,
                    sinon.match.any, sinon.match.any,
                    sinon.match({[option]: 500})
                );
            });
        });

        describe('if images are not equal', () => {
            beforeEach(() => {
                Image.compare.resolves({equal: false});
            });

            describe('assert refs', () => {
                it('should not reject', async () => {
                    const browser = await stubBrowser_().init();

                    await assert.isFulfilled(browser.publicAPI.assertView());
                });

                it('should create "ImageDiffError" error with given parameters', async () => {
                    sandbox.stub(ImageDiffError, 'create').returns(Object.create(ImageDiffError.prototype));

                    temp.path.returns('/curr/path');

                    const browser = await stubBrowser_({getScreenshotPath: () => '/ref/path'}).init();
                    const currImage = stubImage_({size: {width: 100, height: 200}});

                    ScreenShooter.prototype.capture.resolves(currImage);
                    Image.compare.resolves({equal: false, metaInfo: {refImg: {size: {width: 300, height: 400}}}});

                    await browser.publicAPI.assertView('state');

                    assert.calledOnceWith(ImageDiffError.create,
                        'state',
                        {path: '/curr/path', size: {width: 100, height: 200}},
                        {path: '/ref/path', size: {width: 300, height: 400}}
                    );
                });

                it('should remember several "ImageDiffError" errors', async () => {
                    const browser = await stubBrowser_().init();

                    await browser.publicAPI.assertView('foo');
                    await browser.publicAPI.assertView('bar');

                    const [firstError, secondError] = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get();
                    assert.instanceOf(firstError, ImageDiffError);
                    assert.instanceOf(secondError, ImageDiffError);
                    assert.notEqual(firstError, secondError);
                });

                describe('passing diff options', () => {
                    it('should pass diff options for passed image paths', async () => {
                        const config = mkConfig_({getScreenshotPath: () => '/reference/path'});
                        const browser = await stubBrowser_(config).init();
                        temp.path.returns('/current/path');

                        await browser.publicAPI.assertView();
                        const e = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get()[0];

                        assert.match(e.diffOpts, {current: '/current/path', reference: '/reference/path'});
                    });

                    it('should pass diff options with passed compare options', async () => {
                        const config = {
                            tolerance: 100,
                            system: {diffColor: '#111111'}
                        };
                        const browser = await stubBrowser_(config).init();

                        await browser.publicAPI.assertView();
                        const e = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get()[0];

                        assert.match(e.diffOpts, {tolerance: 100, diffColor: '#111111'});
                    });

                    it('should pass diff bounds to error', async () => {
                        Image.compare.resolves({diffBounds: {left: 0, top: 0, right: 10, bottom: 10}});
                        const browser = await stubBrowser_().init();

                        await browser.publicAPI.assertView();

                        const e = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get()[0];

                        assert.deepEqual(e.diffBounds, {left: 0, top: 0, right: 10, bottom: 10});
                    });

                    it('should pass diff clusters to error', async () => {
                        Image.compare.resolves({diffClusters: [{left: 0, top: 0, right: 10, bottom: 10}]});
                        const browser = await stubBrowser_().init();

                        await browser.publicAPI.assertView();
                        const e = browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get()[0];

                        assert.deepEqual(e.diffClusters, [{left: 0, top: 0, right: 10, bottom: 10}]);
                    });
                });
            });

            describe('update refs', () => {
                beforeEach(() => RuntimeConfig.getInstance.returns({updateRefs: true, tempOpts: {}}));

                it('should be fulfilled', async () => {
                    const browser = await stubBrowser_().init();

                    await assert.isFulfilled(browser.publicAPI.assertView());
                });

                ['tolerance', 'antialiasingTolerance'].forEach((option) => {
                    describe(`should update with "${option}" option`, () => {
                        it(`from config option "${option}"`, async () => {
                            const config = mkConfig_({[option]: 1});
                            const browser = await stubBrowser_(config).init();

                            await browser.publicAPI.assertView();

                            assert.calledOnceWith(
                                updateRefs.handleImageDiff,
                                sinon.match.any, sinon.match.any, sinon.match.any,
                                sinon.match({[option]: 1})
                            );
                        });

                        it(`from config option "assertViewOpts" even if it is set in "${option}"`, async () => {
                            const config = mkConfig_({
                                [option]: 1,
                                assertViewOpts: {
                                    [option]: 2
                                }
                            });
                            const browser = await stubBrowser_(config).init();

                            await browser.publicAPI.assertView();

                            assert.calledOnceWith(
                                updateRefs.handleImageDiff,
                                sinon.match.any, sinon.match.any, sinon.match.any,
                                sinon.match({[option]: 2})
                            );
                        });

                        it(`from "assertView" command even if it is set in "assertViewOpts" and "${option}"`, async () => {
                            const config = mkConfig_({
                                [option]: 1,
                                assertViewOpts: {
                                    [option]: 2
                                }
                            });
                            const browser = await stubBrowser_(config).init();

                            await browser.publicAPI.assertView(null, null, {[option]: 3});

                            assert.calledOnceWith(
                                updateRefs.handleImageDiff,
                                sinon.match.any, sinon.match.any, sinon.match.any,
                                sinon.match({[option]: 3})
                            );
                        });
                    });
                });

                it('should pass browser emitter to "handleImageDiff" handler', async () => {
                    const browser = await stubBrowser_().init();
                    browser.prepareScreenshot.resolves({canHaveCaret: true});

                    await browser.publicAPI.assertView();

                    assert.calledOnceWith(
                        updateRefs.handleImageDiff,
                        sinon.match.any, sinon.match.any, sinon.match.any,
                        sinon.match({emitter: browser.emitter})
                    );
                });
            });
        });
    });

    it('should remember several success assert view calls', async () => {
        Image.compare
            .onFirstCall().resolves({equal: true, metaInfo: {refImg: {size: {height: 200, width: 100}}}})
            .onSecondCall().resolves({equal: true, metaInfo: {refImg: {size: {height: 400, width: 300}}}});
        const getScreenshotPath = sandbox.stub();

        getScreenshotPath
            .withArgs(sinon.match.any, 'plain').returns('/ref/path/plain')
            .withArgs(sinon.match.any, 'complex').returns('/ref/path/complex');

        const bufferPlain = Buffer.from('plain-data', 'base64');
        const bufferComplex = Buffer.from('complex-data', 'base64');

        fs.readFileSync
            .withArgs('/ref/path/plain').returns(bufferPlain)
            .withArgs('/ref/path/complex').returns(bufferComplex);

        const imagePlain = stubImage_({size: {width: 100, height: 200}});
        const imageComplex = stubImage_({size: {width: 300, height: 400}});

        Image.create
            .withArgs(bufferPlain).returns(imagePlain)
            .withArgs(bufferComplex).returns(imageComplex);

        const browser = await stubBrowser_({getScreenshotPath}).init();

        await browser.publicAPI.assertView('plain');
        await browser.publicAPI.assertView('complex');

        assert.deepEqual(browser.publicAPI.executionContext.hermioneCtx.assertViewResults.get(), [
            {stateName: 'plain', refImg: {path: '/ref/path/plain', size: {width: 100, height: 200}}},
            {stateName: 'complex', refImg: {path: '/ref/path/complex', size: {width: 300, height: 400}}}
        ]);
    });
});
