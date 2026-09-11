import { initializeApp } from 'firebase/app'
import firebaseConfig from './firebaseConfig'

export const firebaseConfigured = Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== 'placeholder'

export default firebaseConfigured ? initializeApp(firebaseConfig) : null
