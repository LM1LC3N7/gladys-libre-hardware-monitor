// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container. No onSetValue: every
// feature is read only, this integration sends no command to the PC.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.publishDiscovery());
  gladys.onDeviceCreated((device) => app.deviceChanged(device));
  gladys.onDeviceUpdated((device) => app.deviceChanged(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Configuration screen button --------------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration saved by the user: refused credentials are tried again.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config, { force: true });
  });

  // --- Connection lifecycle: (re)start on every connection, pause while Gladys is away.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
