import { Module } from '@nestjs/common';
import { ContentLinkController } from './content-link.controller.js';
import { ContentLinkService } from './content-link.service.js';
import { ProductMediaController } from './product-media.controller.js';
import { ProductMediaService } from './product-media.service.js';
import { ProductController } from './product.controller.js';
import { ProductService } from './product.service.js';

@Module({
  controllers: [ProductController, ProductMediaController, ContentLinkController],
  providers: [ProductService, ProductMediaService, ContentLinkService],
})
export class ProductsModule {}
