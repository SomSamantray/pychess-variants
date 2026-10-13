import { h, type VNode } from 'snabbdom';
import { _ } from '../i18n';
import type { AnalysisController } from './analysisCtrl';

const CONNECTION_KEY = 'externalEngineConnection';
const SOURCE_KEY = 'analysisEngineSource';
const connectedThisPage = new Set<string>();

export interface ExternalConnection {
    address: string;
    token: string;
}

export function storedExternalConnection(): ExternalConnection | undefined {
    try {
        const value = JSON.parse(localStorage.getItem(CONNECTION_KEY) ?? 'null');
        if (typeof value?.address === 'string' && typeof value?.token === 'string') return value;
    } catch {
        /* Malformed preferences can be replaced using Connect. */
    }
    return undefined;
}

export function preferredEngineSource(): 'browser' | 'external' {
    return localStorage.getItem(SOURCE_KEY) === 'external' ? 'external' : 'browser';
}

export function saveEngineSource(source: 'browser' | 'external'): void {
    localStorage.setItem(SOURCE_KEY, source);
}

export function rememberExternalConnection(connection: ExternalConnection): void {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    connectedThisPage.add(connection.address);
}

export function forgetExternalConnection(): void {
    const connection = storedExternalConnection();
    if (connection) connectedThisPage.delete(connection.address);
    localStorage.removeItem(CONNECTION_KEY);
}

export async function mayRestoreExternalConnection(address: string): Promise<boolean> {
    if (connectedThisPage.has(address)) return true;
    try {
        const permission = await navigator.permissions.query({ name: 'loopback-network' as PermissionName });
        return permission.state === 'granted';
    } catch {
        return false;
    }
}

export class ExternalEngineSettings {
    private root?: HTMLElement;
    private address = storedExternalConnection()?.address ?? 'http://127.0.0.1:9670';
    private token = storedExternalConnection()?.token ?? '';

    constructor(private readonly controller: () => AnalysisController | undefined) {}

    view(): VNode {
        const input = (name: string, label: string, value: string, type: string, update: (value: string) => void) =>
            h('div.external-engine-field', [
                h('label', { attrs: { for: name } }, label),
                h('input#' + name, {
                    props: { type, value, autocomplete: 'off', spellcheck: false },
                    on: { input: event => update((event.target as HTMLInputElement).value) },
                }),
            ]);
        return h(
            'div.analysis-settings-group.external-engine-settings',
            {
                hook: {
                    insert: vnode => {
                        this.root = vnode.elm as HTMLElement;
                        this.refresh();
                    },
                },
            },
            [
                h('div.external-engine-field', [
                    h('label', { attrs: { for: 'analysis-engine-source' } }, _('Analysis engine')),
                    h(
                        'select#analysis-engine-source',
                        {
                            props: { value: preferredEngineSource() },
                            on: {
                                change: event =>
                                    this.controller()?.selectEngineSource(
                                        (event.target as HTMLSelectElement).value === 'external'
                                            ? 'external'
                                            : 'browser',
                                    ),
                            },
                        },
                        [
                            h('option', { props: { value: 'browser' } }, _('Browser engine')),
                            h('option', { props: { value: 'external' } }, _('External engine')),
                        ],
                    ),
                ]),
                input('external-engine-address', _('Local address'), this.address, 'url', value => {
                    this.address = value;
                }),
                input('external-engine-token', _('Pairing token'), this.token, 'password', value => {
                    this.token = value;
                }),
                h('div.external-engine-actions', [
                    h(
                    'button#external-engine-connect.button',
                        {
                            props: { type: 'button' },
                            on: {
                                click: () => {
                                    void this.controller()?.connectExternalEngine(this.address, this.token);
                                },
                            },
                        },
                        _('Connect'),
                    ),
                    h(
                    'button#external-engine-disconnect.button',
                        {
                            props: { type: 'button' },
                            on: {
                                click: () => this.controller()?.disconnectExternalEngine(),
                            },
                        },
                        _('Disconnect'),
                    ),
                    h(
                    'button#external-engine-forget.button',
                        {
                            props: { type: 'button' },
                            on: {
                                click: () => {
                                    this.controller()?.disconnectExternalEngine(true);
                                    this.token = '';
                                    const input = this.root?.querySelector<HTMLInputElement>('#external-engine-token');
                                    if (input) input.value = '';
                                },
                            },
                        },
                        _('Forget'),
                    ),
                ]),
                h('p#external-engine-status', { attrs: { role: 'status', 'aria-live': 'polite' } }),
                h('small', _('Start your local engine app and enter its pairing token.')),
            ],
        );
    }

    refresh(): void {
        const ctrl = this.controller();
        const root = this.root;
        if (!ctrl || !root) return;
        const select = root.querySelector<HTMLSelectElement>('#analysis-engine-source');
        const connect = root.querySelector<HTMLButtonElement>('#external-engine-connect');
        const disconnect = root.querySelector<HTMLButtonElement>('#external-engine-disconnect');
        const status = root.querySelector<HTMLElement>('#external-engine-status');
        const allowed = ctrl.canUseExternalEngine();
        if (select) {
            select.value = ctrl.engineSource;
            const externalOption = select.querySelector<HTMLOptionElement>('option[value="external"]');
            if (externalOption) externalOption.disabled = !allowed;
        }
        if (connect) connect.disabled = !allowed || ctrl.externalEngineStatus === 'loading';
        if (disconnect) disconnect.disabled = ctrl.externalEngineStatus === 'disconnected';
        if (status) status.textContent = ctrl.externalEngineStatusText();
        root.closest<HTMLElement>('.analysis-settings')?.setAttribute('data-engine-source', ctrl.engineSource);
    }
}
