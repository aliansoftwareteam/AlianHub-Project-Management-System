import { initializeApp } from 'firebase/app'
import firebaseConfig from './firebaseConfig'

const configured = Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== 'placeholder'

export default configured ? initializeApp(firebaseConfig) : null
