# Saad Drive live build

This build keeps the original dashboard look and connects the PIN screen to the server-side auth route.

Deploy: import into Vercel, set the four environment variables, then redeploy.
Generate the hash for demo PIN 246810:
node -e "console.log(require('crypto').createHash('sha256').update('246810').digest('hex'))"

Important: this is the safe auth/dashboard pass. Telegram upload/download and persistent folder metadata are the next backend pass, not faked in the UI.
