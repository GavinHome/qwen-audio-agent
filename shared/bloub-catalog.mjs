// Bloub 外观目录：设置界面与 web 渲染层共用的单一事实来源。
// 选项与中文标签来自 bloub 上游（src/bot/skins.ts、expressions.ts、
// src/i18n/locales/zh.ts，MIT 协议）。id 与引擎内的目录一一对应；
// 引擎数据在 web/src/bloub/bot/ 下，这里是配置选择链用的精简镜像。

export const BLOUB_SHAPES = Object.freeze([
  Object.freeze({ id: 'cercle', displayName: '圆形' }),
  Object.freeze({ id: 'galet', displayName: '卵石' }),
  Object.freeze({ id: 'squircle', displayName: '方圆' }),
  Object.freeze({ id: 'capsule', displayName: '胶囊' }),
  Object.freeze({ id: 'triangle', displayName: '三角' }),
  Object.freeze({ id: 'hexagone', displayName: '六边' }),
  Object.freeze({ id: 'nuage', displayName: '云朵' }),
  Object.freeze({ id: 'goutte', displayName: '水滴' }),
])

export const BLOUB_COLORS = Object.freeze([
  Object.freeze({ id: 'encre', displayName: '墨黑', hex: '#0a0a0c' }),
  Object.freeze({ id: 'creme', displayName: '奶油白', hex: '#f1efe9' }),
  Object.freeze({ id: 'brun', displayName: '棕色', hex: '#8b5e3c' }),
  Object.freeze({ id: 'rouge', displayName: '红色', hex: '#e8483f' }),
  Object.freeze({ id: 'orange', displayName: '橙色', hex: '#f08a24' }),
  Object.freeze({ id: 'ambre', displayName: '琥珀色', hex: '#f0b429' }),
  Object.freeze({ id: 'vert', displayName: '绿色', hex: '#3ecf8e' }),
  Object.freeze({ id: 'turquoise', displayName: '青绿色', hex: '#2fbfa0' }),
  Object.freeze({ id: 'bleu', displayName: '蓝色', hex: '#3b93f0' }),
  Object.freeze({ id: 'violet', displayName: '紫色', hex: '#8b5cf6' }),
  Object.freeze({ id: 'rose', displayName: '粉色', hex: '#e152b0' }),
  Object.freeze({ id: 'gris', displayName: '灰色', hex: '#a3a3a3' }),
])

export const BLOUB_EXPRESSIONS = Object.freeze([
  Object.freeze({ id: 'neutre', displayName: '平静' }),
  Object.freeze({ id: 'attentif', displayName: '专注' }),
  Object.freeze({ id: 'surpris', displayName: '惊讶' }),
  Object.freeze({ id: 'excite', displayName: '兴奋' }),
  Object.freeze({ id: 'heureux', displayName: '开心' }),
  Object.freeze({ id: 'hilare', displayName: '大笑' }),
  Object.freeze({ id: 'colere', displayName: '生气' }),
  Object.freeze({ id: 'triste', displayName: '难过' }),
  Object.freeze({ id: 'effraye', displayName: '害怕' }),
  Object.freeze({ id: 'mefiant', displayName: '怀疑' }),
  Object.freeze({ id: 'confus', displayName: '困惑' }),
  Object.freeze({ id: 'curieux', displayName: '好奇' }),
  Object.freeze({ id: 'fier', displayName: '得意' }),
  Object.freeze({ id: 'timide', displayName: '羞怯' }),
  Object.freeze({ id: 'blase', displayName: '无趣' }),
  Object.freeze({ id: 'somnolent', displayName: '困倦' }),
])

export const DEFAULT_BLOUB_SHAPE = 'cercle'
export const DEFAULT_BLOUB_COLOR = 'encre'
export const DEFAULT_BLOUB_EXPRESSION = 'neutre'

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
