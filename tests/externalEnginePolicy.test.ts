import { expect, jest, test, beforeEach } from '@jest/globals';
import { upsertActiveCevalRound } from '../client/antiCheat';

jest.unstable_mockModule('chessgroundx', () => ({ Chessground: jest.fn() }));
const { AnalysisController } = await import('../client/analysis/analysisCtrl');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

function controller() {
    const ctrl = Object.create(AnalysisController.prototype) as any;
    ctrl.destroyed = false;
    ctrl.externalAllowed = true;
    ctrl.externalRulesInvalid = false;
    ctrl.engineSource = 'external';
    ctrl.engineVariant = 'chess';
    ctrl.chess960 = false;
    ctrl.analysisContext = { capabilities: { engineTools: true, localAnalysisAllowed: true } };
    ctrl.externalSearch = { supports: jest.fn(() => true), stop: jest.fn(), status: 'ready' };
    ctrl.browserSearch = { stop: jest.fn() };
    ctrl.connectionGeneration = 0;
    ctrl.engineStop = jest.fn();
    ctrl.pvboxIni = jest.fn();
    ctrl.refreshEngineLabel = jest.fn();
    ctrl.refreshLocalAnalysisAvailabilityForAntiCheat = jest.fn();
    return ctrl;
}

test('external capability is independent of WASM readiness and variant support', () => {
    const ctrl = controller();
    ctrl.localEngine = false;
    ctrl.isEngineReady = false;
    ctrl.variantSupportedByFSF = false;
    expect(ctrl.isSelectedEngineReady()).toBe(true);
    ctrl.engineSource = 'browser';
    expect(ctrl.isSelectedEngineReady()).toBe(false);
});

test('registration selection applies variant restrictions alongside exact-rule validity', () => {
    const ctrl = controller();
    const connection = { engine: { name: 'One engine', variants: ['chess', 'alice'],
        chess960: true, customRules: true, maxThreads: 2, maxHash: 64, maxMultiPv: 2,
        variantRestrictions: { alice: { chess960: false, customRules: false } } } };
    expect(ctrl.supportsExternalEngine(connection)).toBe(true);
    ctrl.engineVariant = 'alice';
    expect(ctrl.supportsExternalEngine(connection)).toBe(true);
    ctrl.chess960 = true;
    expect(ctrl.supportsExternalEngine(connection)).toBe(false);
    ctrl.chess960 = false;
    ctrl.externalRulesText = '[alice:chess]';
    expect(ctrl.supportsExternalEngine(connection)).toBe(false);
    ctrl.engineVariant = 'new-snapshot';
    expect(ctrl.supportsExternalEngine(connection)).toBe(true);
    ctrl.externalRulesInvalid = true;
    expect(ctrl.supportsExternalEngine(connection)).toBe(false);
});

test('ongoing games, Practice/unsupported adapters, concealed lessons and anti-cheat block external use', () => {
    const ctrl = controller();
    expect(ctrl.canUseExternalEngine()).toBe(true);
    ctrl.analysisContext.capabilities.localAnalysisAllowed = false;
    expect(ctrl.canUseExternalEngine()).toBe(false);
    ctrl.analysisContext.capabilities.localAnalysisAllowed = true;
    ctrl.externalAllowed = false;
    expect(ctrl.canUseExternalEngine()).toBe(false);
    ctrl.externalAllowed = true;
    Object.defineProperty(ctrl, 'analysisExtension', {
        value: { allowComputerSearch: () => false },
        configurable: true,
    });
    expect(ctrl.canUseExternalEngine()).toBe(false);
    Object.defineProperty(ctrl, 'analysisExtension', { value: undefined, configurable: true });
    upsertActiveCevalRound('active-game', Date.now());
    expect(ctrl.canUseExternalEngine()).toBe(false);
    expect(ctrl.isSelectedEngineReady()).toBe(false);
});

test('switching source during pairing does not persist or activate a stale connection', async () => {
    const ctrl = controller();
    let resolvePairing: () => void = () => {};
    ctrl.externalSearch.connect = jest.fn(
        () =>
            new Promise<void>(resolve => {
                resolvePairing = resolve;
            }),
    );
    const pairing = ctrl.connectExternalEngine('http://127.0.0.1:9670', 'x'.repeat(43));
    ctrl.selectEngineSource('browser');
    resolvePairing();
    await pairing;
    expect(ctrl.engineSource).toBe('browser');
    expect(localStorage.getItem('externalEngineConnection')).toBeNull();
    expect(localStorage.getItem('analysisEngineSource')).toBe('browser');
    expect(ctrl.pvboxIni).toHaveBeenCalledTimes(1);
});
