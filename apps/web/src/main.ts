import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { registerAuthRefreshHandler } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
registerAuthRefreshHandler()
app.use(router)

app.mount('#app')
