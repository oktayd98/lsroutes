import { Controller, Get } from '@nestjs/common';
import { Controller as Other, Get as OtherGet } from 'routing-controllers';
import { CrudController } from './common/crud.controller';

const ROUTES = { posts: 'posts' };

@Controller(ROUTES.posts)
export class PostsController extends CrudController {
  @Get(':id') // GET /api/v1/posts/:id
  show() {}

  remove() {}
}

@Other('other') // not Nest
export class OtherController {
  @OtherGet('x')
  x() {}
}
