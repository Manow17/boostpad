// Boostpad Training: freeplay checkpoints and impulse setups, a BakkesMod plugin made for Boostpad.
// Boostpad's Training page sets its buttons and options (bp_* settings) and installs it.
//
// Checkpoints
//   bp_rewind            freeze Free Play; steer left/right to go back and forth through the last seconds;
//                        press again to play on from there
//   bp_checkpoint        while rewinding: keep this moment as a checkpoint; while playing: jump back to
//                        the current checkpoint
//   bp_checkpoint_prev / bp_checkpoint_next   step through the saved checkpoints
//   bp_checkpoint_delete / bp_checkpoint_clear
//   bp_mirror            mirror the current moment left/right
//   bp_freeze_ball       hold the ball where it is (again to let go)
// Impulse setups
//   bp_impulse           put the ball somewhere around your car and launch it toward where you will be
//                        (bp_impulse_* settings: kind, distance, side, height, speed, lead, spin, random)
//
// Only in Free Play (and Custom Training if bp_in_training is on), never online.
#include "bakkesmod/plugin/bakkesmodplugin.h"
#include <algorithm>
#include <cmath>
#include <ctime>
#include <deque>
#include <fstream>
#include <random>
#include <sstream>
#include <string>
#include <vector>

struct Snap {
  RBState car;
  RBState ball;
  float boost = 33.3f;
};

class BoostpadTraining : public BakkesMod::Plugin::BakkesModPlugin {
 public:
  void onLoad() override;
  void onUnload() override;

 private:
  std::deque<Snap> history;      // newest at the back, one per physics tick
  std::vector<Snap> checkpoints;
  int current = -1;              // checkpoint in use
  bool frozen = false;           // rewinding
  double scrub = 0;              // ticks back from the newest while rewinding
  bool previewing = false;       // showing a checkpoint while rewinding
  bool ballHeld = false;
  Snap held;
  std::string message;           // shown on screen for a moment
  float messageUntil = 0;
  std::mt19937 rng{std::random_device{}()};

  bool active();
  bool parts(CarWrapper& car, BallWrapper& ball);
  Snap take();
  void apply(const Snap& s, bool moving);
  void tick();
  void say(const std::string& text, float seconds = 1.5f);
  float setting(const char* name) { return cvarManager->getCvar(name).getFloatValue(); }
  float rnd(float spread) { return spread <= 0 ? 0 : std::uniform_real_distribution<float>(-spread, spread)(rng); }
  Snap vary(Snap s);
  void save();
  void load();
  void impulse();
  void draw(CanvasWrapper canvas);
};

BAKKESMOD_PLUGIN(BoostpadTraining, "Boostpad Training", "1.0", PLUGINTYPE_FREEPLAY | PLUGINTYPE_CUSTOM_TRAINING)

static const float TICK = 1.0f / 120.0f;

void BoostpadTraining::onLoad() {
  cvarManager->registerCvar("bp_history", "30", "Seconds of Free Play kept for rewinding", true, true, 5, true, 120);
  cvarManager->registerCvar("bp_scrub_speed", "1.5", "How fast steering scrubs while rewinding (x real time)", true, true, 0.1f, true, 8);
  cvarManager->registerCvar("bp_in_training", "0", "Also work in Custom Training", true, true, 0, true, 1);
  cvarManager->registerCvar("bp_reset_on_goal", "0", "Go back to the checkpoint after a goal", true, true, 0, true, 1);
  cvarManager->registerCvar("bp_variance", "0", "Change each loaded checkpoint a little (0-100)", true, true, 0, true, 100);
  cvarManager->registerCvar("bp_mirror_random", "0", "Load checkpoints mirrored half of the time", true, true, 0, true, 1);
  cvarManager->registerCvar("bp_show_text", "1", "Show what happens on screen", true, true, 0, true, 1);
  cvarManager->registerCvar("bp_impulse_kind", "pass", "pass, lob, high, wall, bounce or custom");
  cvarManager->registerCvar("bp_impulse_distance", "2200", "How far from the car the ball starts", true, true, 300, true, 6000);
  cvarManager->registerCvar("bp_impulse_side", "0", "Where around the car it starts, in degrees (0 ahead, 90 right, -90 left, 180 behind)", true, true, -180, true, 180);
  cvarManager->registerCvar("bp_impulse_height", "120", "Height the ball starts at", true, true, 93, true, 1900);
  cvarManager->registerCvar("bp_impulse_speed", "1400", "Ball speed", true, true, 200, true, 6000);
  cvarManager->registerCvar("bp_impulse_target_height", "150", "Height where the ball meets you", true, true, 93, true, 1800);
  cvarManager->registerCvar("bp_impulse_lead", "0.8", "Aim where the car will be after this many seconds", true, true, 0, true, 3);
  cvarManager->registerCvar("bp_impulse_spin", "0", "Ball spin (0-6)", true, true, 0, true, 6);
  cvarManager->registerCvar("bp_impulse_random", "15", "Randomness of each launch (0-100)", true, true, 0, true, 100);
  cvarManager->registerCvar("bp_impulse_stop_car", "0", "Stop the car when launching", true, true, 0, true, 1);

  cvarManager->registerNotifier("bp_rewind", [this](std::vector<std::string>) {
    if (!active()) return;
    if (!frozen) {
      if (history.empty()) return;
      frozen = true; scrub = 0; previewing = false;
      say("Rewind  (steer to scrub)", 2.5f);
    } else {
      frozen = false;
      // play on from the moment shown; the future after it is dropped
      if (!previewing) {
        size_t back = (size_t)std::round(scrub);
        if (back < history.size()) { Snap s = history[history.size() - 1 - back]; history.resize(history.size() - back); apply(s, true); }
      } else if (current >= 0) apply(checkpoints[current], true);
      previewing = false;
      say("Play");
    }
  }, "Rewind Free Play (again to play on)", PERMISSION_FREEPLAY);

  cvarManager->registerNotifier("bp_checkpoint", [this](std::vector<std::string>) {
    if (!active()) return;
    if (frozen && !previewing) {
      size_t back = (size_t)std::round(scrub);
      if (back >= history.size()) return;
      checkpoints.push_back(history[history.size() - 1 - back]);
      current = (int)checkpoints.size() - 1;
      save();
      say("Checkpoint " + std::to_string(current + 1) + " saved");
    } else if (current >= 0 && current < (int)checkpoints.size()) {
      frozen = false; previewing = false;
      Snap s = vary(checkpoints[current]);
      apply(s, true);
      say("Checkpoint " + std::to_string(current + 1));
    } else say("No checkpoint yet: rewind, then save one");
  }, "Save a checkpoint while rewinding, or load the current one", PERMISSION_FREEPLAY);

  auto step = [this](int d) {
    if (!active() || checkpoints.empty()) { say("No checkpoints"); return; }
    current = ((current + d) % (int)checkpoints.size() + (int)checkpoints.size()) % (int)checkpoints.size();
    if (frozen) { previewing = true; apply(checkpoints[current], false); }
    else apply(vary(checkpoints[current]), true);
    say("Checkpoint " + std::to_string(current + 1) + " of " + std::to_string(checkpoints.size()));
  };
  cvarManager->registerNotifier("bp_checkpoint_prev", [step](std::vector<std::string>) { step(-1); }, "Previous checkpoint", PERMISSION_FREEPLAY);
  cvarManager->registerNotifier("bp_checkpoint_next", [step](std::vector<std::string>) { step(1); }, "Next checkpoint", PERMISSION_FREEPLAY);
  cvarManager->registerNotifier("bp_checkpoint_delete", [this](std::vector<std::string>) {
    if (current < 0 || current >= (int)checkpoints.size()) return;
    checkpoints.erase(checkpoints.begin() + current);
    if (current >= (int)checkpoints.size()) current = (int)checkpoints.size() - 1;
    save(); say("Checkpoint deleted");
  }, "Delete the current checkpoint", PERMISSION_ALL);
  cvarManager->registerNotifier("bp_checkpoint_clear", [this](std::vector<std::string>) {
    checkpoints.clear(); current = -1; save(); say("Checkpoints cleared");
  }, "Delete all checkpoints", PERMISSION_ALL);

  cvarManager->registerNotifier("bp_mirror", [this](std::vector<std::string>) {
    if (!active()) return;
    Snap s = take();
    auto m = [](RBState& r) {
      r.Location.X = -r.Location.X; r.LinearVelocity.X = -r.LinearVelocity.X;
      r.AngularVelocity.Y = -r.AngularVelocity.Y; r.AngularVelocity.Z = -r.AngularVelocity.Z;
      r.Quaternion.Y = -r.Quaternion.Y; r.Quaternion.Z = -r.Quaternion.Z;
    };
    m(s.car); m(s.ball);
    apply(s, !frozen);
    say("Mirrored");
  }, "Mirror the moment left/right", PERMISSION_FREEPLAY);

  cvarManager->registerNotifier("bp_freeze_ball", [this](std::vector<std::string>) {
    if (!active()) return;
    ballHeld = !ballHeld;
    if (ballHeld) held = take();
    say(ballHeld ? "Ball held" : "Ball free");
  }, "Hold the ball where it is", PERMISSION_FREEPLAY);

  cvarManager->registerNotifier("bp_impulse", [this](std::vector<std::string>) { if (active()) impulse(); },
    "Launch the ball as set in bp_impulse_*", PERMISSION_FREEPLAY);

  gameWrapper->HookEvent("Function TAGame.Car_TA.SetVehicleInput", [this](std::string) { tick(); });
  gameWrapper->HookEvent("Function TAGame.Ball_TA.OnHitGoal", [this](std::string) {
    if (!active() || !cvarManager->getCvar("bp_reset_on_goal").getBoolValue() || current < 0) return;
    gameWrapper->SetTimeout([this](GameWrapper*) { if (active() && current >= 0) apply(vary(checkpoints[current]), true); }, 0.5f);
  });
  gameWrapper->HookEvent("Function TAGame.GameEvent_TA.Destroyed", [this](std::string) { history.clear(); frozen = false; ballHeld = false; });
  gameWrapper->RegisterDrawable([this](CanvasWrapper c) { draw(c); });
  load();
}

void BoostpadTraining::onUnload() { save(); }

bool BoostpadTraining::active() {
  if (gameWrapper->IsInOnlineGame()) return false;
  if (gameWrapper->IsInFreeplay()) return true;
  return gameWrapper->IsInCustomTraining() && cvarManager->getCvar("bp_in_training").getBoolValue();
}

bool BoostpadTraining::parts(CarWrapper& car, BallWrapper& ball) {
  ServerWrapper server = gameWrapper->GetGameEventAsServer();
  if (server.IsNull()) return false;
  ball = server.GetBall();
  car = gameWrapper->GetLocalCar();
  return !ball.IsNull() && !car.IsNull();
}

Snap BoostpadTraining::take() {
  Snap s;
  CarWrapper car(0); BallWrapper ball(0);
  if (!parts(car, ball)) return s;
  s.car = car.GetRBState();
  s.ball = ball.GetRBState();
  BoostWrapper b = car.GetBoostComponent();
  if (!b.IsNull()) s.boost = b.GetCurrentBoostAmount();
  return s;
}

void BoostpadTraining::apply(const Snap& s, bool moving) {
  CarWrapper car(0); BallWrapper ball(0);
  if (!parts(car, ball)) return;
  RBState c = s.car, b = s.ball;
  if (!moving) { c.LinearVelocity = Vector(0, 0, 0); c.AngularVelocity = Vector(0, 0, 0); b.LinearVelocity = Vector(0, 0, 0); b.AngularVelocity = Vector(0, 0, 0); }
  car.SetPhysicsState(c);
  ball.SetPhysicsState(b);
  BoostWrapper boost = car.GetBoostComponent();
  if (!boost.IsNull()) boost.SetCurrentBoostAmount(s.boost);
}

Snap BoostpadTraining::vary(Snap s) {
  float v = setting("bp_variance") / 100.0f;
  if (v > 0) {
    auto spread = [&](Vector& vel, float speedPart, float sidePart) {
      float speed = std::sqrt(vel.X * vel.X + vel.Y * vel.Y + vel.Z * vel.Z);
      vel.X *= 1 + rnd(speedPart * v); vel.Y *= 1 + rnd(speedPart * v); vel.Z *= 1 + rnd(speedPart * v);
      vel.X += rnd(sidePart * v * speed); vel.Y += rnd(sidePart * v * speed);
    };
    spread(s.ball.LinearVelocity, 0.25f, 0.15f);
    spread(s.car.LinearVelocity, 0.15f, 0.08f);
    s.ball.AngularVelocity.X += rnd(2 * v); s.ball.AngularVelocity.Y += rnd(2 * v); s.ball.AngularVelocity.Z += rnd(2 * v);
  }
  if (cvarManager->getCvar("bp_mirror_random").getBoolValue() && (rng() & 1)) {
    for (RBState* r : {&s.car, &s.ball}) {
      r->Location.X = -r->Location.X; r->LinearVelocity.X = -r->LinearVelocity.X;
      r->AngularVelocity.Y = -r->AngularVelocity.Y; r->AngularVelocity.Z = -r->AngularVelocity.Z;
      r->Quaternion.Y = -r->Quaternion.Y; r->Quaternion.Z = -r->Quaternion.Z;
    }
  }
  return s;
}

void BoostpadTraining::tick() {
  if (!active()) return;
  CarWrapper car(0); BallWrapper ball(0);
  if (!parts(car, ball)) return;
  if (frozen) {
    if (previewing) { if (current >= 0) apply(checkpoints[current], false); return; }
    ControllerInput in = car.GetInput();
    float speed = setting("bp_scrub_speed");
    scrub -= in.Steer * speed;                     // steer right: forward in time, left: back
    if (scrub < 0) scrub = 0;
    if (scrub > (double)history.size() - 1) scrub = (double)history.size() - 1;
    size_t back = (size_t)std::round(scrub);
    if (back < history.size()) apply(history[history.size() - 1 - back], false);
    return;
  }
  if (ballHeld) {
    RBState b = held.ball; b.LinearVelocity = Vector(0, 0, 0); b.AngularVelocity = Vector(0, 0, 0);
    ball.SetPhysicsState(b);
  }
  history.push_back(take());
  size_t keep = (size_t)(setting("bp_history") / TICK);
  while (history.size() > keep) history.pop_front();
}

// ---------- impulse setups ----------

static Vector forwardOf(const Quat& q) {
  // the car's nose direction from its rotation
  return Vector(1 - 2 * (q.Y * q.Y + q.Z * q.Z), 2 * (q.X * q.Y + q.W * q.Z), 2 * (q.X * q.Z - q.W * q.Y));
}

void BoostpadTraining::impulse() {
  CarWrapper car(0); BallWrapper ball(0);
  if (!parts(car, ball)) return;
  frozen = false; previewing = false; ballHeld = false;
  std::string kind = cvarManager->getCvar("bp_impulse_kind").getStringValue();
  float distance = setting("bp_impulse_distance"), side = setting("bp_impulse_side"), height = setting("bp_impulse_height");
  float speed = setting("bp_impulse_speed"), targetHeight = setting("bp_impulse_target_height"), lead = setting("bp_impulse_lead");
  float spin = setting("bp_impulse_spin"), random = setting("bp_impulse_random") / 100.0f;
  // the kinds are starting points; the bp_impulse_* settings tune them
  if (kind == "pass") { height = 100; targetHeight = 100; }
  else if (kind == "lob") { height = 100; targetHeight = 900; speed = std::min(speed, 1600.0f); }
  else if (kind == "high") { side = 0; height = 1400; targetHeight = 1200; lead = std::max(lead, 1.0f); }
  else if (kind == "wall") { side = side >= 0 ? 90 : -90; height = 600; targetHeight = 300; }
  else if (kind == "bounce") { height = 900; targetHeight = 93; }
  side += rnd(35 * random); distance *= 1 + rnd(0.3f * random); speed *= 1 + rnd(0.25f * random);
  height = std::max(93.0f, height * (1 + rnd(0.3f * random))); targetHeight = std::max(93.0f, targetHeight * (1 + rnd(0.3f * random)));

  RBState c = car.GetRBState();
  Vector f = forwardOf(c.Quaternion);
  float flat = std::sqrt(f.X * f.X + f.Y * f.Y);
  if (flat < 0.01f) { f = Vector(0, 1, 0); flat = 1; }
  f.X /= flat; f.Y /= flat;
  float a = side * 3.14159265f / 180.0f;
  Vector dir(f.X * std::cos(a) - f.Y * std::sin(a), f.X * std::sin(a) + f.Y * std::cos(a), 0);
  Vector start(c.Location.X + dir.X * distance, c.Location.Y + dir.Y * distance, height);
  // keep it inside the pitch (walls at 4096 x 5120, ceiling at 2044)
  start.X = std::max(-3900.0f, std::min(3900.0f, start.X));
  start.Y = std::max(-4950.0f, std::min(4950.0f, start.Y));
  start.Z = std::max(93.0f, std::min(1900.0f, start.Z));
  Vector target(c.Location.X + c.LinearVelocity.X * lead, c.Location.Y + c.LinearVelocity.Y * lead, targetHeight);
  // a ballistic throw under the game's gravity (650 uu/s/s) that reaches the target at about `speed`
  Vector d = target - start;
  float flatDist = std::sqrt(d.X * d.X + d.Y * d.Y);
  float t = std::max(0.35f, flatDist / std::max(200.0f, speed));
  const float g = -650.0f;
  Vector v(d.X / t, d.Y / t, (d.Z - 0.5f * g * t * t) / t);
  if (kind == "bounce") v.Z = std::min(v.Z, -200.0f);  // straight down onto the ground first

  RBState b = ball.GetRBState();
  b.Location = start;
  b.LinearVelocity = v;
  b.AngularVelocity = Vector(rnd(spin) + spin * 0.3f, rnd(spin), rnd(spin));
  ball.SetPhysicsState(b);
  if (cvarManager->getCvar("bp_impulse_stop_car").getBoolValue()) { c.LinearVelocity = Vector(0, 0, 0); c.AngularVelocity = Vector(0, 0, 0); car.SetPhysicsState(c); }
  say("Impulse: " + kind, 1.0f);
}

// ---------- on screen and on disk ----------

void BoostpadTraining::say(const std::string& text, float seconds) {
  message = text;
  messageUntil = (float)(clock() / (double)CLOCKS_PER_SEC) + seconds;
}

void BoostpadTraining::draw(CanvasWrapper canvas) {
  if (!active() || !cvarManager->getCvar("bp_show_text").getBoolValue()) return;
  float now = (float)(clock() / (double)CLOCKS_PER_SEC);
  std::string text = frozen ? (previewing ? "CHECKPOINT " + std::to_string(current + 1) : "REWIND  -" + std::to_string((int)std::round(scrub * TICK * 10) / 10.0).substr(0, 4) + " s") : "";
  if (now < messageUntil) text = text.empty() ? message : text + "   " + message;
  if (text.empty()) return;
  Vector2 size = canvas.GetSize();
  canvas.SetColor(LinearColor{0, 0, 0, 150});
  canvas.SetPosition(Vector2{size.X / 2 - 210, 62});
  canvas.FillBox(Vector2{420, 40});
  canvas.SetColor(LinearColor{0, 216, 200, 255});
  canvas.SetPosition(Vector2{size.X / 2 - 200, 70});
  canvas.DrawString(text, 2.0f, 2.0f, true);
}

static std::string serialize(const RBState& r) {
  std::ostringstream o;
  o << r.Location.X << ' ' << r.Location.Y << ' ' << r.Location.Z << ' ' << r.LinearVelocity.X << ' ' << r.LinearVelocity.Y << ' ' << r.LinearVelocity.Z << ' '
    << r.AngularVelocity.X << ' ' << r.AngularVelocity.Y << ' ' << r.AngularVelocity.Z << ' ' << r.Quaternion.X << ' ' << r.Quaternion.Y << ' ' << r.Quaternion.Z << ' ' << r.Quaternion.W;
  return o.str();
}
static void parse(std::istream& in, RBState& r) {
  in >> r.Location.X >> r.Location.Y >> r.Location.Z >> r.LinearVelocity.X >> r.LinearVelocity.Y >> r.LinearVelocity.Z
     >> r.AngularVelocity.X >> r.AngularVelocity.Y >> r.AngularVelocity.Z >> r.Quaternion.X >> r.Quaternion.Y >> r.Quaternion.Z >> r.Quaternion.W;
}

void BoostpadTraining::save() {
  std::ofstream out(gameWrapper->GetDataFolder() / "boostpad_checkpoints.txt");
  for (const Snap& s : checkpoints) out << serialize(s.car) << ' ' << serialize(s.ball) << ' ' << s.boost << '\n';
}

void BoostpadTraining::load() {
  std::ifstream in(gameWrapper->GetDataFolder() / "boostpad_checkpoints.txt");
  std::string line;
  while (std::getline(in, line)) {
    std::istringstream l(line);
    Snap s;
    parse(l, s.car); parse(l, s.ball); l >> s.boost;
    if (l) checkpoints.push_back(s);
  }
  current = checkpoints.empty() ? -1 : 0;
}
