import { binanceClock } from "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1";
import { KlineFeed as CoreKlineFeed } from "./chart-core.js?v=26-102-tape-live-edge-minute-boundary-v1";

export * from "./chart-core.js?v=26-102-tape-live-edge-minute-boundary-v1";

// The core owns #scheduleBoundaryTick and #advanceBoundary. This facade keeps
// those private methods untouched while enforcing the same calibration contract
// at their public lifecycle boundary.
export class KlineFeed extends CoreKlineFeed {
  constructor(options) {
    super(options);
    this.boundaryCalibrationGuard = () => {
      if (binanceClock.isCalibrated()) return;
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    };
    binanceClock.addEventListener("statechange", this.boundaryCalibrationGuard);
    this.boundaryCalibrationGuard();
  }

  async select(...args) {
    try {
      return await super.select(...args);
    } finally {
      this.boundaryCalibrationGuard();
    }
  }

  destroy() {
    binanceClock.removeEventListener("statechange", this.boundaryCalibrationGuard);
    super.destroy();
  }
}
