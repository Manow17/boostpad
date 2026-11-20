# Controller drawings

The controller overlay uses these drawings. Both are MIT-licensed; their licence texts are in `src/`.

| Controller | Source | Licence |
| --- | --- | --- |
| PS4 DualShock 4 | [dracula/gamepad-viewer](https://github.com/dracula/gamepad-viewer) (`ds4/`), Copyright (c) 2021 Dracula Theme | MIT, `src/LICENSE-dracula-gamepad-viewer.txt` |
| PS5 DualSense | [Zergatul/Zergatul.Obs.InputOverlay](https://github.com/Zergatul/Zergatul.Obs.InputOverlay) (`src/wwwroot/DualSense-XInput.svg`), Copyright (c) 2021 Igor Budzhak | MIT, `src/LICENSE-zergatul-inputoverlay.txt` |
| Xbox Series controller | same project (`src/wwwroot/XBoxSeriesX-XInput.svg`) | MIT, as above |

`scripts/prepare-controllers.js` turns them into `pads.js`: it removes their own colours (Boostpad colours them, so they can be recoloured), makes their ids unique and tags each button so it can light up. The shapes themselves are unchanged. Boostpad adds the light-up spots on the PS4 drawing, placed where the original project's style sheet (`src/ds4/edit.css`) puts each part.

PlayStation, DualShock and DualSense are trademarks of Sony Interactive Entertainment; Xbox is a trademark of Microsoft. Boostpad is not affiliated with either.
