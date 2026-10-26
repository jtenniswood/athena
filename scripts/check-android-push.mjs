import { createFirebaseSender } from './firebase-messaging.mjs'

const sender = createFirebaseSender()
if (!sender.enabled) {
  console.error('Set ATHENA_FIREBASE_CREDENTIALS to your private Firebase service-account JSON file.')
  process.exitCode = 1
} else {
  try {
    await sender.validate()
    console.log('Firebase push authentication and message validation passed. No notification was sent.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
