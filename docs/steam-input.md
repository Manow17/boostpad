# OpenW Input and Steam Input: the measured maths

OpenW Input's sticks compute what Steam Input's **Joystick** mode computes, setting for setting. Valve does not publish these formulas or the default values, so they were measured from the Steam client itself (November 2026):

- Steam's settings page asks the Steam client for each setting's value, range and default, and shows a live preview of what the stick sends. With Steam's developer debugging on for one session, OpenW read both.
- A virtual DualShock 4 (ViGEmBus) played exact stick positions while Steam ran a layout, under 61 setting combinations; Steam's preview reported its output for each, about 9,000 points.
- The formulas below reproduce every one of those points to within 5 of 32767. `test/steam-measured.json` holds a spread of them, and `npm test` checks OpenW against them.

Nothing was saved in Steam; the layout files were compared with a backup afterwards and are unchanged.

## Units

Sticks run from -32768 to 32767 (up and right positive). A DualShock 4 or DualSense stick byte `b` reads as `257*b - 32768` across and `32767 - 257*b` up, exactly as in Steam. Settings are stored as Steam stores them (Steam's layout files use the same numbers).

## Defaults (as the Steam client reports them)

| Setting | Steam key | Default | Range |
| --- | --- | --- | --- |
| Deadzone source | `deadzone_enable_type` | 0 None (1 Calibration, 2 Custom) | 0–2 |
| Deadzone inner | `deadzone_inner_radius` | 0 | 0–32000 |
| Deadzone outer | `deadzone_outer_radius` | 28000 | 0–32000 |
| Deadzone shape | `deadzone_shape` | 1 Circle (0 Cross, 2 Square) | 0–2 |
| Stick response curve | `curve_exponent` | 0 Linear (1 Aggressive, 2 Relaxed, 3 Wide, 4 Extra Wide, 5 Custom) | 0–5 |
| Custom response curve | `custom_curve_exponent` | 200 | 25–375 |
| Anti-deadzone | `anti_deadzone` | 0 | 0–32767 |
| Anti-deadzone buffer | `anti_deadzone_buffer` | 0 | 0–32767 |
| Outer ring radius | `edge_binding_radius` | 25000 | 1–32767 |
| Horizontal / vertical scale | `sensitivity_horiz_scale` / `sensitivity_vert_scale` | 100 | 0–100 |
| Trigger range start / end | (trigger) inner / outer | 1000 / 32000 | 0–32767 |

## The formulas

With `M = 32767`, a stick at `(x, y)`:

1. **No dead zone** (source None, or Inner 0 with Outer 32000): only the response curve, on the round distance; with a Linear curve the stick is passed on untouched.
2. Otherwise, on the raw values:
   - **Anti-deadzone buffer** `B`: a distance below `B` gives 0.
   - **Anti-deadzone** `A`: a distance `d` becomes `A + d*(1 - A/M)`.
   - Both work on the round distance for Circle, and on each axis for Cross and Square.
3. **Response curve**, always on the round distance `r` (0..1): `s*r / (1 + (s-1)*r)`, where `s` is the curve's slope at the centre: Linear 1, Aggressive 3, Relaxed 1/2, Wide 3/7, Extra Wide 1/3. Custom value `v`, with `x = v/100`: `x³/(x³+1)` up to 201 (so 100 is Relaxed) and `1 + (4-x)^-7` from 202.
4. **Inner and outer**: `t = clamp((d - inner) / (outer - inner), 0, 1)`; Circle on the round distance (direction kept), Cross and Square on each axis.
5. **Square** then puts the result on a square's edge: the larger output is the round length of the per-axis result, and the smaller one is that length times the angle / 45°.
6. Each output is clamped to ±32767 and cut to a whole number.

**Calibration** as the source used the layout's own inner and outer values in the measurements.

## Not measured

- Triggers: Steam's preview does not cover them. OpenW uses Steam's range values (1000 to 32000) and the stick curves.
- Sensitivity scale, invert and the outer ring command: applied in the obvious way, not measured.
- Mouse output, rotation, gyro and Steam's other modes are not part of OpenW Input.
