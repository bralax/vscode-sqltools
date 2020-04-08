import { Uri, commands, Disposable, EventEmitter, ViewColumn, WebviewPanel, window } from 'vscode';
import { getIconPaths } from '@sqltools/vscode/icons';
import Context from '@sqltools/vscode/context';
import { EXT_NAMESPACE } from '@sqltools/util/constants';

export default abstract class WebviewProvider<State = any> implements Disposable {
  get serializationId() {
    return this.id;
  }
  public disposeEvent: EventEmitter<never> = new EventEmitter();
  public get onDidDispose() {
    return this.disposeEvent.event;
  }
  public get visible() { return this.panel === undefined ? false : this.panel.visible; }
  protected cssVariables: { [name: string]: string };
  private get baseHtml(): string {
    const cssVariables = Object.keys(this.cssVariables || {}).map(k => `--sqltools-${k}: ${this.cssVariables[k]}`).join(';');
    const extRoot = Uri.file(Context.asAbsolutePath('.'))
    .with({ scheme: 'vscode-resource' })
    .toString();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${this.title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  :root {${cssVariables}}
  </style>
  <link rel="stylesheet" type="text/css" href="${extRoot}/ui/commons.css">
  <script type="text/javascript" charset="UTF-8">window.extRoot = ${JSON.stringify(extRoot)};</script>
</head>
<body>
  <link rel="stylesheet" type="text/css" href="${extRoot}/ui/theme.css">
  <div id="root"></div>
  <script src="${extRoot}/ui/vendor.js" type="text/javascript" charset="UTF-8"></script>
  <script src="${extRoot}/ui/commons.js" type="text/javascript" charset="UTF-8"></script>
  <script src="${extRoot}/ui/${this.id}.js" type="text/javascript" charset="UTF-8"></script>
</body>
</html>`;
  }
  protected html: string;
  protected abstract id: string;
  protected abstract title: string;
  private panel: WebviewPanel;
  private disposables: Disposable[] = [];
  private messageCb;

  public constructor(private iconsPath: Uri, private viewsPath: Uri) {}
  public preserveFocus = true;
  public wereToShow = ViewColumn.One;
  public show() {
    if (!this.panel) {
      this.panel = window.createWebviewPanel(
        this.serializationId,
        this.title,
        this.wereToShow,
        {
          enableScripts: true,
          retainContextWhenHidden: true, // @TODO remove and migrate to state restore
          enableCommandUris: true,
          localResourceRoots: [this.iconsPath, this.viewsPath],
          // enableFindWidget: true,
        },
      );
      this.panel.iconPath = getIconPaths('database-active');
      this.panel.webview.onDidReceiveMessage(this.onDidReceiveMessage, null, this.disposables);
      this.panel.onDidChangeViewState(({ webviewPanel }) => {
        this.setPreviewActiveContext(webviewPanel.active);
      }, null, this.disposables);
      this.panel.onDidDispose(this.dispose, null, this.disposables);
      this.panel.webview.html = this.html || this.baseHtml;
    }

    this.updatePanelName();

    this.panel.reveal(this.wereToShow, this.preserveFocus);
    this.setPreviewActiveContext(true);
  }

  private onDidReceiveMessage = ({ action, payload, ...rest}) => {
    switch(action) {
      case 'receivedState':
        this.lastState = payload;
        break;
      case 'call':
        commands.executeCommand(payload.command, ...(payload.args || []));
        break;
      case 'viewReady':
        process.env.NODE_ENV === 'development' && commands.executeCommand('workbench.action.webview.openDeveloperTools');
        break;
    }
    if (this.messageCb) {
      this.messageCb(({ action, payload, ...rest }));
    }
  }

  public hide = () => {
    if (this.panel === undefined) return;
    this.setPreviewActiveContext(false);
    this.panel.dispose();
  }
  public dispose = () => {
    this.hide();
    if (this.disposables.length) this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.panel = undefined;
    this.disposeEvent.fire();
  }

  public postMessage = (message: any) => {
    if (!this.panel) return;
    this.panel.webview.postMessage(message);
  }
  public setMessageCallback = (cb) => {
    this.messageCb = cb;
  }

  private setPreviewActiveContext = (value: boolean) => {
		commands.executeCommand('setContext', `${EXT_NAMESPACE}.${this.id}.active`, value);
  }

  private lastState = undefined;
  public getState = (): Promise<State> => {
    if (!this.panel) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        if (typeof this.lastState === 'undefined') {
          if (attempts < 10) return attempts++;

          clearInterval(timer);
          return reject(new Error(`Could not get the state for ${this.panel.title}`));
        }
        clearInterval(timer);
        const state = this.lastState;
        this.lastState = undefined;
        return resolve(state);
      }, 200);
      this.panel.webview.postMessage({ action: 'getState' });
    })
  }

  public updatePanelName = () => {
    if (this.panel) this.panel.title = this.title;
  }
}