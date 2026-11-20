import { Body, Controller, Get, Param, Post, Put, Version } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get() // GET /api/v1/users
  findAll() {}

  @Get(':id') // GET /api/v1/users/:id
  findOne(@Param('id') id: string) {}

  @Post() // POST /api/v1/users
  create(@Body() body: unknown) {}

  @Version(['2', '3'])
  @Get(':id/profile') // GET /api/v2/users/:id/profile, GET /api/v3/users/:id/profile
  profile() {}

  @Put([':id', ':id/replace']) // PUT /api/v1/users/:id, PUT /api/v1/users/:id/replace
  replace() {}

  helper() {} // not a route

  @Get('static') // not a route: Nest only looks at prototype methods
  static make() {}
}
