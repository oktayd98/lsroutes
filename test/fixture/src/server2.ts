import express, { Router } from 'express';
class UserController {
  public router = Router();
  constructor() { this.router.get('/me', this.me); }
  me(req, res) {}
}
class App {
  public app = express();
  constructor(controllers: any[]) {
    controllers.forEach((c) => this.app.use('/v2', c.router));
  }
}
new App([new UserController()]);
