import { Module } from '@nestjs/common';
import { UsersController } from './users/users.controller';
import { HealthController, WebhooksController } from './misc.controller';
import { PostsController } from './posts.controller';

@Module({ controllers: [UsersController, HealthController, WebhooksController, PostsController] })
export class AppModule {}
