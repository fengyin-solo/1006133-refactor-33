import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { bootstrapMortarData } from './domain/mortar'
import App from './App.vue'
import router from './router'
import './styles/global.css'

// 老批次按拌制日期补登，且判据版本一变就把未冻结批次重新过一遍（幂等）。
bootstrapMortarData()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
