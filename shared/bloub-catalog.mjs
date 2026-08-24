// Bloub 外观目录：设置界面与 web 渲染层共用的单一事实来源。
// 选项与中文标签来自 bloub 上游（src/bot/skins.ts、expressions.ts、
// src/i18n/locales/zh.ts，MIT 协议）；英文名对照上游 en 语言包。
// id 与引擎内的目录一一对应；引擎数据在 web/src/bloub/bot/ 下，
// 这里是配置选择链用的精简镜像。目录自带双语标签：设置界面的
// option 是动态渲染的，不走 localizeDesktopDocument 的文本遍历。

export const BLOUB_SHAPES = Object.freeze([
  Object.freeze({ id: 'cercle', displayName: '圆形', displayNameEn: 'Circle' }),
  Object.freeze({ id: 'galet', displayName: '卵石', displayNameEn: 'Pebble' }),
  Object.freeze({ id: 'squircle', displayName: '方圆', displayNameEn: 'Squircle' }),
  Object.freeze({ id: 'capsule', displayName: '胶囊', displayNameEn: 'Capsule' }),
  Object.freeze({ id: 'triangle', displayName: '三角', displayNameEn: 'Triangle' }),
  Object.freeze({ id: 'hexagone', displayName: '六边', displayNameEn: 'Hexagon' }),
  Object.freeze({ id: 'nuage', displayName: '云朵', displayNameEn: 'Cloud' }),
  Object.freeze({ id: 'goutte', displayName: '水滴', displayNameEn: 'Droplet' }),
])

export const BLOUB_COLORS = Object.freeze([
  Object.freeze({ id: 'encre', displayName: '墨黑', displayNameEn: 'Ink', hex: '#0a0a0c' }),
  Object.freeze({ id: 'creme', displayName: '奶油白', displayNameEn: 'Cream', hex: '#f1efe9' }),
  Object.freeze({ id: 'brun', displayName: '棕色', displayNameEn: 'Brown', hex: '#8b5e3c' }),
  Object.freeze({ id: 'rouge', displayName: '红色', displayNameEn: 'Red', hex: '#e8483f' }),
  Object.freeze({ id: 'orange', displayName: '橙色', displayNameEn: 'Orange', hex: '#f08a24' }),
  Object.freeze({ id: 'ambre', displayName: '琥珀色', displayNameEn: 'Amber', hex: '#f0b429' }),
  Object.freeze({ id: 'vert', displayName: '绿色', displayNameEn: 'Green', hex: '#3ecf8e' }),
  Object.freeze({ id: 'turquoise', displayName: '青绿色', displayNameEn: 'Teal', hex: '#2fbfa0' }),
  Object.freeze({ id: 'bleu', displayName: '蓝色', displayNameEn: 'Blue', hex: '#3b93f0' }),
  Object.freeze({ id: 'violet', displayName: '紫色', displayNameEn: 'Purple', hex: '#8b5cf6' }),
  Object.freeze({ id: 'rose', displayName: '粉色', displayNameEn: 'Pink', hex: '#e152b0' }),
  Object.freeze({ id: 'gris', displayName: '灰色', displayNameEn: 'Gray', hex: '#a3a3a3' }),
])

export const BLOUB_EXPRESSIONS = Object.freeze([
  Object.freeze({ id: 'neutre', displayName: '平静', displayNameEn: 'Neutral' }),
  Object.freeze({ id: 'attentif', displayName: '专注', displayNameEn: 'Attentive' }),
  Object.freeze({ id: 'surpris', displayName: '惊讶', displayNameEn: 'Surprised' }),
  Object.freeze({ id: 'excite', displayName: '兴奋', displayNameEn: 'Excited' }),
  Object.freeze({ id: 'heureux', displayName: '开心', displayNameEn: 'Happy' }),
  Object.freeze({ id: 'hilare', displayName: '大笑', displayNameEn: 'Hilarious' }),
  Object.freeze({ id: 'colere', displayName: '生气', displayNameEn: 'Angry' }),
  Object.freeze({ id: 'triste', displayName: '难过', displayNameEn: 'Sad' }),
  Object.freeze({ id: 'effraye', displayName: '害怕', displayNameEn: 'Scared' }),
  Object.freeze({ id: 'mefiant', displayName: '怀疑', displayNameEn: 'Suspicious' }),
  Object.freeze({ id: 'confus', displayName: '困惑', displayNameEn: 'Confused' }),
  Object.freeze({ id: 'curieux', displayName: '好奇', displayNameEn: 'Curious' }),
  Object.freeze({ id: 'fier', displayName: '得意', displayNameEn: 'Proud' }),
  Object.freeze({ id: 'timide', displayName: '羞怯', displayNameEn: 'Shy' }),
  Object.freeze({ id: 'blase', displayName: '无趣', displayNameEn: 'Bored' }),
  Object.freeze({ id: 'somnolent', displayName: '困倦', displayNameEn: 'Sleepy' }),
])

export const DEFAULT_BLOUB_SHAPE = 'cercle'
export const DEFAULT_BLOUB_COLOR = 'encre'
export const DEFAULT_BLOUB_EXPRESSION = 'neutre'

// 目录条目按界面语言取标签；没有英文标签的条目（如用户导入数据）回退中文。
export function bloubEntryLabel(entry, language = 'zh-CN') {
  if (language === 'en' && entry?.displayNameEn) return entry.displayNameEn
  return entry?.displayName ?? entry?.id ?? ''
}

function catalogIds(catalog) {
  return new Set(catalog.map(entry => entry.id))
}

export function normalizeBloubChoice(catalog, value, fallback) {
  const id = String(value || '').trim()
  return catalogIds(catalog).has(id) ? id : fallback
}

export function normalizeBloubShape(value) {
  return normalizeBloubChoice(BLOUB_SHAPES, value, DEFAULT_BLOUB_SHAPE)
}

export function normalizeBloubColor(value) {
  return normalizeBloubChoice(BLOUB_COLORS, value, DEFAULT_BLOUB_COLOR)
}

export function normalizeBloubExpression(value) {
  return normalizeBloubChoice(
    BLOUB_EXPRESSIONS,
    value,
    DEFAULT_BLOUB_EXPRESSION,
  )
}
