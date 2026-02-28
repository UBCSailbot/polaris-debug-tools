//#ifndef SPIMOD_H
//#define SPIMOD_H
//
//#include "main.h"
//#include "stm32u5xx_hal.h" //might change this line, drk what it means
//
//void SPIMod_Init();
//void SPIMod_ReadWrite();
//
//#endif


#ifndef SPIMOD_H
#define SPIMOD_H

#include "stm32u5xx_hal.h"

//#ifdef __cplusplus
//extern "C" {
//#endif

void SPIMod_Init(void);

/**
 * @brief Transmit one byte and receive one byte (full-duplex).
 * @param tx   byte to send
 * @param prx  pointer to store received byte (can be NULL)
 * @return HAL_OK if success
 */
void SPIMod_ReadWrite(void);

/**
 * @brief Transmit len bytes and receive len bytes.
 * @param buf     tx buffer
 * @param len     length
 * @param rx_buf  buffer to store rx bytes (can be NULL)
 * @return HAL_OK if success
 */
//HAL_StatusTypeDef SPIMod_SendBuffer(const uint8_t *buf, uint16_t len, uint8_t *rx_buf);

//#ifdef __cplusplus


#endif /* SPIMOD_H */

