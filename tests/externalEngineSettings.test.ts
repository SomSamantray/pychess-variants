import { expect, jest, test } from '@jest/globals';
import { ExternalEngineSettings } from '../client/analysis/externalEngineSettings';
import type { AnalysisController } from '../client/analysis/analysisCtrl';
import { patch } from '../client/document';

test('external actions are native buttons and respect page-policy disabled states', () => {
    let allowed = false;
    const connect = jest.fn<() => Promise<void>>(async () => {});
    const ctrl = {
        engineSource: 'browser',
        externalEngineStatus: 'disconnected',
        canUseExternalEngine: () => allowed,
        externalEngineStatusText: () => 'Unavailable',
        connectExternalEngine: connect,
    } as unknown as AnalysisController;
    const settings = new ExternalEngineSettings(() => ctrl);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const vnode = patch(host, settings.view());
    const element = vnode.elm as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>('#external-engine-connect')!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.classList.contains('button')).toBe(true);
    expect(button.disabled).toBe(true);
    button.click();
    expect(connect).not.toHaveBeenCalled();
    allowed = true;
    settings.refresh();
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    expect(connect).toHaveBeenCalledTimes(1);
    element.remove();
});
