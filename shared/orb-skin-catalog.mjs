// 悬浮球皮肤目录：主进程与 web 渲染层共用的单一事实来源。
// 皮肤 = { id, type, displayName, displayNameEn? }。内置皮肤是 theme 类型
// （CSS/SVG 渲染），导入皮肤是 sprite 类型（Codex pet 包渲染），两者共用
// 同一选择链。displayNameEn 与 displayName 并列：设置界面的皮肤下拉是
// 动态渲染的，不走 localizeDesktopDocument 的文本遍历，所以内置皮肤
// 自带双语标签，导入皮肤回退 displayName。

export const BUILTIN_ORB_SKINS = Object.freeze([
  Object.freeze({ id: 'fluid', type: 'theme', displayName: '流光声波球', displayNameEn: 'Aurora Wave Orb' }),
  Object.freeze({ id: 'goo', type: 'theme', displayName: '液态渐变球', displayNameEn: 'Liquid Gradient Orb' }),
  Object.freeze({ id: 'bloub-bot', type: 'theme', displayName: 'Bloub 墨球', displayNameEn: 'Bloub Ink Orb' }),
])

export const ORB_SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function isBuiltinOrbSkin(id) {
  return BUILTIN_ORB_SKINS.some(skin => skin.id === String(id || ''))
}

export function normalizeOrbSkinId(value) {
  const id = String(value || '').trim()
  return ORB_SKIN_ID_PATTERN.test(id) ? id : ''
}

// 统一回退链：orbSkin → orbStyle（旧配置只读兼容）→ defaultSkin → fluid。
export function resolveOrbSkinId({ orbSkin, orbStyle } = {}, defaultSkin) {
  return (
    normalizeOrbSkinId(orbSkin)
    || normalizeOrbSkinId(orbStyle)
    || normalizeOrbSkinId(defaultSkin)
    || 'fluid'
  )
}
