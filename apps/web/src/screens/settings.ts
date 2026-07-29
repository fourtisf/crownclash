/**
 * Profile / settings modal — crown-clash.html L2933-2936 (bindings) and L2934-2946.
 *
 * Name, avatar and the SFX flag all live in the save, so they go through
 * `POST /save/profile` and come back sanitised (`validate.ts` trims the name to 16 chars and
 * the avatar to 8). The prototype mutated `S` directly on every avatar tap; here the taps
 * only update a local draft and paint the header, because `S` is the server's copy and the
 * only thing allowed to replace it is `setSave()`.
 */
import { $$, must } from '../dom';
import { Snd, setSfxEnabled } from '../engine';
import { setQuality } from '../gfx';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { closeModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { setTab } from '../ui/tabs';
import { refreshHeader } from './home';
import { STR } from './strings';
import { apiMessage } from './errors';
import type { ProfileUpdateRequest, Quality } from '@crown/shared';

const AVATARS = ['👑', '⚔️', '🛡️', '🐉', '🔥', '💀', '🦁', '🧙', '🏹', '⚡'];

/** L2934-2946 */
export function openSettings(): void {
  // Draft state: nothing here touches the save until SAVE is pressed.
  let draftAvatar = S.avatar;

  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.settings.title +
      '</h2><p class="sub">' + STR.settings.sub + '</p>' +
      // L2937 — the prototype strips double quotes so the value attribute survives. Kept
      // verbatim; the server also caps the name at 16 chars on the way back.
      '<input class="inputbox" id="stName" maxlength="16" value="' + S.name.replace(/"/g, '') + '">' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:12px 0">' +
      AVATARS.map(
        (e) => '<button class="wopt" data-av="' + e + '" style="width:auto;padding:8px 10px;margin:0;font-size:20px">' + e + '</button>',
      ).join('') +
      '</div>' +
      '<button class="btn ' + (S.sfx ? 'green' : 'ghost') + '" id="stSfx" style="width:100%;margin-bottom:8px">' +
      (S.sfx ? STR.settings.sfxOn : STR.settings.sfxOff) + '</button>' +
      // Graphics preset. Applied the moment it is tapped rather than on SAVE, because the
      // only way to judge it is to look at it — and the arena is one tap away.
      '<div class="qlabel">' + STR.settings.quality + '</div>' +
      '<div class="qrow" id="stQuality">' +
      (['low', 'med', 'high'] as const)
        .map(
          (q) =>
            '<button class="qbtn' + (S.quality === q ? ' on' : '') + '" data-q="' + q + '">' +
            STR.settings.qualityNames[q] + '</button>',
        )
        .join('') +
      '</div>' +
      '<button class="btn gold" id="stSave" style="width:100%">' + STR.settings.save + '</button>' +
      '<div class="hint" style="margin-top:10px">' + STR.settings.note + '</div>',
  );

  /** Live-preview the avatar in the header without writing to the save. */
  const previewAvatar = (emoji: string): void => {
    draftAvatar = emoji;
    const node = must('#avatarBox').firstChild;
    if (node) node.textContent = emoji;
  };

  $$<HTMLButtonElement>('[data-av]', m).forEach((b) => {
    b.onclick = () => {
      const av = b.dataset.av;
      if (av) previewAvatar(av);
    };
  });

  /**
   * `{ avatar }` only when the player actually picked one of the ten, otherwise `{}`.
   *
   * The server rejects any avatar outside `PROFILE_AVATARS` with `invalid_profile`
   * (`routes/save.ts` L119), but `sanitizeSave` only length-caps the field — so a save that
   * arrived through `/save/migrate` can legitimately hold an emoji the modal does not offer.
   * Echoing it back would 400 and make the whole modal unusable: SAVE would fail even when
   * all the player wanted was to change their name. `draftAvatar` moves only through
   * `previewAvatar`, which is wired to the ten buttons and nothing else, so "differs from
   * `S.avatar`" is exactly "came from this modal".
   */
  const avatarPatch = (): ProfileUpdateRequest =>
    draftAvatar === S.avatar ? {} : { avatar: draftAvatar };

  // Dismissing without saving must not leave the drafted avatar in the header. Watching the
  // overlay covers every exit — ✕, the backdrop, and a programmatic `closeModal()` — where
  // wrapping the `[data-close]` buttons only covered ✕ and left a backdrop-dismissed preview
  // showing an avatar the account does not have. The observer disconnects itself on the first
  // close, so repeated visits do not stack watchers on a long-lived element (see B1).
  const ovl = must('#ovl');
  const nameBox = must<HTMLInputElement>('#stName');
  const watcher = new MutationObserver(() => {
    // `nameBox.isConnected` is what makes this reliable across the SFX toggle, which does
    // `closeModal(); openSettings();` inside one task: the observer callback is a microtask,
    // so by the time it runs the overlay is `.on` again and a class check alone would never
    // fire — leaving this watcher observing forever while the reopened modal added another.
    // The old modal's input is detached by then, which is the unambiguous signal.
    if (nameBox.isConnected && ovl.classList.contains('on')) return;
    watcher.disconnect();
    refreshHeader();
  });
  watcher.observe(ovl, { attributes: true, attributeFilter: ['class'] });

  const sfx = must<HTMLButtonElement>('#stSfx');
  sfx.onclick = async () => {
    sfx.disabled = true;
    try {
      // The avatar draft rides along. The prototype wrote `S.avatar` the moment a face was
      // tapped, so toggling SUARA (which reopens the modal) kept the choice; sending only
      // `sfx` would reopen against the server's untouched avatar and silently discard it.
      const res = await api.updateProfile({ sfx: !S.sfx, ...avatarPatch() });
      setSave(res.save);
      setSfxEnabled(res.save.sfx);
      // L2944 — the prototype reopened the modal to repaint the button; same here.
      closeModal();
      openSettings();
    } catch (err) {
      sfx.disabled = false;
      toastTop(apiMessage(err, STR.settings.saveFailed));
    }
  };

  // Graphics preset: apply immediately and persist immediately. It is a device preference,
  // not part of the name/avatar draft that SAVE commits.
  must('#stQuality').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.qbtn');
    if (!b) return;
    const q = b.dataset.q as Quality;
    if (!q || q === S.quality) return;
    setQuality(q);
    S.quality = q;
    must('#stQuality').querySelectorAll('.qbtn').forEach((n) => n.classList.toggle('on', (n as HTMLElement).dataset.q === q));
    Snd.play(700, 0.05, 'triangle', 0.05);
    void api
      .updateProfile({ quality: q })
      .then((r) => setSave(r.save))
      .catch(() => undefined);
  });

  const save = must<HTMLButtonElement>('#stSave');
  save.onclick = async () => {
    const v = nameBox.value.trim();
    const req: ProfileUpdateRequest = avatarPatch();
    // L2945 — an empty box keeps the current name rather than clearing it.
    if (v) req.name = v;
    // The route refuses an empty patch (`no fields to update`). Nothing to change here means
    // the prototype's SAVE was a no-op too — close and go home rather than toast a failure.
    if (req.name === undefined && req.avatar === undefined) {
      closeModal();
      setTab('home');
      return;
    }
    save.disabled = true;
    try {
      const res = await api.updateProfile(req);
      setSave(res.save);
      refreshHeader();
      closeModal();
      setTab('home');
    } catch (err) {
      save.disabled = false;
      refreshHeader();
      toastTop(apiMessage(err, STR.settings.saveFailed));
    }
  };
}
