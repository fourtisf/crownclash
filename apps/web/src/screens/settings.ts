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
import { setSfxEnabled } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { closeModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { setTab } from '../ui/tabs';
import { refreshHeader } from './home';
import { STR } from './strings';
import { apiMessage } from './errors';
import type { ProfileUpdateRequest } from '@crown/shared';

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

  // Dismissing without saving must not leave the drafted avatar in the header.
  m.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
    const prev = b.onclick;
    b.onclick = (ev) => {
      if (prev) prev.call(b, ev);
      refreshHeader();
    };
  });

  const sfx = must<HTMLButtonElement>('#stSfx');
  sfx.onclick = async () => {
    sfx.disabled = true;
    try {
      const res = await api.updateProfile({ sfx: !S.sfx });
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

  const save = must<HTMLButtonElement>('#stSave');
  save.onclick = async () => {
    const v = must<HTMLInputElement>('#stName').value.trim();
    const req: ProfileUpdateRequest = { avatar: draftAvatar };
    // L2945 — an empty box keeps the current name rather than clearing it.
    if (v) req.name = v;
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
