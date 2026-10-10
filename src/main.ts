import Phaser from 'phaser';
import './style.css';
import { FrontierTownScene } from './frontier-town-map';
import { initializeLoadingScreen } from './loading-screen';

initializeLoadingScreen();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#536852',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true, pixelArt: false },
  scene: FrontierTownScene,
});
