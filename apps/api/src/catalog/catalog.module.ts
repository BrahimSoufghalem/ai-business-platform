import { Module } from '@nestjs/common';
import { ProductTypeController, ProductTypeTemplateController } from './product-type.controller.js';
import { ProductTypeService } from './product-type.service.js';

@Module({
  controllers: [ProductTypeTemplateController, ProductTypeController],
  providers: [ProductTypeService],
})
export class CatalogModule {}
