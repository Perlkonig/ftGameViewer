# Full Thrust Game Viewer

A modern, lightweight, reactive web application for managing remote games of [Full Thrust](https://shop.groundzerogames.co.uk/rules.html). It doesn't impose or enforce any particular rules, but it does provide numerous helper functions to streamline basic game play.

The game runs entirely in your browser. There is no server architecture, and internet access is not required once you've downloaded the files.

**NOTE:** The page is 100% designed for mouse and keyboard on a big screen. I welcome pull requests related to touch controls and accessibility, but a Full Thrust game really is not ideal for small screens.

I sadly just have not had the time to focus on this project, so I'm putting it out into the world. I'm not abandoning it, but I just don't know when I will have time to focus on this. I'm active on GitHub and will monitor for pull requests and the like. If you want to get involved in the project, do let me know.

Currently the system displays a pan+zoomable map and lets you define players and place ships. You can measure distance between objects, and if you click on a ship, you can view firing arcs for some weapon systems, but not all. There's still *lots* to do to make this a workable tool.

## How it Works

## Support

I believe in the "value for value" model. If you find this tool valuable, consider a donation proportional to that value: [paypal.me/abstractplay](https://www.paypal.me/abstractplay). Thank you!

## Developers

This site is built on the [Svelte framework](https://svelte.dev/), using the [Bulma CSS library](https://bulma.io/) and good ol' [scalable vector graphics (SVG)](https://www.w3.org/Graphics/SVG/).

If you want to contribute to the code, here's how to get the development environment up and running:

* Install [NodeJS](https://nodejs.org).
* Clone the repo.
* From the newly cloned folder, type `npm i` to install all the dependencies.
* Then type `npm run dev` to start up the dev server.

Ideally you'd submit any changes via pull request, but if you wanted to just host your own instance, run `npm run build` and then move everything in the `dist` folder to some host somewhere.

The core ship handling code (including glyph drawing and JSON schema) has been abstracted into a standalone package: <https://github.com/Perlkonig/ftLibShip>.
