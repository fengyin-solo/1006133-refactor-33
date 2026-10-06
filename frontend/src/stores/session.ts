import { defineStore } from 'pinia'

export const OPERATOR_ROLES = [
  '拌制站负责人',
  '检验员',
  '注浆班长',
  '值班管理员',
] as const

export type OperatorRole = (typeof OPERATOR_ROLES)[number]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班管理员' as OperatorRole,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canDiscardMortar: (state) => state.role === '拌制站负责人',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
      this.operator = role
    },
  },
})
