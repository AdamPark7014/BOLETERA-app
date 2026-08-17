import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Métodos que el cuerpo público puede *pedir*. No es una autorización: el
 * servicio vuelve a validarlos contra el canal efectivo (F1-01), porque
 * CASH/COMP solo existen en taquilla y antes bastaba mandarlos por POST.
 */
export const REQUESTABLE_PAYMENT_METHODS = ['CARD', 'SPEI', 'OXXO', 'CASH', 'COMP'] as const;

export class OrderLineDto {
  @IsString()
  @IsNotEmpty()
  offerId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  holdIds!: string[];
}

/**
 * Cuerpo aceptado por `POST /orders`. Con el ValidationPipe global
 * (`whitelist` + `forbidNonWhitelisted`) todo lo que no esté aquí se rechaza:
 * en particular `userId`, que ahora solo puede venir del JWT, y `isComp`, que
 * exige personal autenticado y se decide en el servicio.
 */
export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  holdIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items?: OrderLineDto[];

  @IsString()
  @MaxLength(120)
  buyerName!: string;

  @IsEmail()
  @MaxLength(255)
  buyerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  buyerPhone?: string;

  @IsOptional()
  @IsIn(REQUESTABLE_PAYMENT_METHODS as unknown as string[])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionCode?: string;

  /** Motivo de la cortesía; solo se usa si el actor está autorizado a emitirla. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  compReason?: string;
}

/**
 * Quién pide leer una orden. `userId`/`email` salen del JWT verificado y
 * `accessToken` del enlace enviado por correo al comprador invitado.
 */
export type OrderRequester = {
  userId?: string;
  email?: string;
  accessToken?: string;
};
