# Deploy from your phone

## Option: Render

1. Create a GitHub account if you don't already have one.
2. Create a new GitHub repository.
3. Upload every file/folder from this project into the repository.
4. Open Render and sign in with GitHub.
5. Choose **New → Web Service** and select the repository.
6. Render can use the included `render.yaml`. If configuring manually:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
7. Deploy.
8. Render gives you an `https://...onrender.com` URL.
9. Open that URL on your phone.
10. Create a room and share the URL + room code with everyone.

The included Render configuration is set up for persistent storage. If `/var/data` is unavailable in your service configuration, the app falls back to local `data.json` (which is not persistent across redeploys/restarts on ephemeral filesystems).

## Installing it like an app

On Android Chrome:
1. Open the deployed HTTPS URL.
2. Open the browser menu.
3. Tap **Add to Home screen** or **Install app**.
4. Open the new icon like a normal app.

## Important

The app still uses the room code as its access control. Anyone who has the code can edit the room.
