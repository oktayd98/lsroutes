import { Delete, Get } from '@nestjs/common';

export abstract class CrudController {
  @Get() // GET /api/v1/posts (inherited by PostsController)
  list() {}

  @Delete(':id') // not a route: PostsController overrides it without a decorator
  remove() {}
}
