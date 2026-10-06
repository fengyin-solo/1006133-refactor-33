import { defineStore } from 'pinia'

export type SessionRole = '值班管理员' | '拌制站负责人' | '试验检测员' | '注浆班组'

export const SESSION_ROLES: SessionRole[] = ['值班管理员', '拌制站负责人', '试验检测员', '注浆班组']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班管理员' as SessionRole,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: SessionRole) {
      this.role = role
      this.operator = role
    },
  },
})
