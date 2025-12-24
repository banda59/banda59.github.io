---
title: "Road to Windows Minifilter Drivers (CVE-2024-30085)"
date: "2025-08-15"
tags: ["Windows"]
excerpt: "Windows Minifilter Driver 분석&1-day"
---
최근 Windows Kernel Driver을 공부하다가 Bus Driver, Filter Driver, FSD, Minifilter와 같은 목적에 따른 다양한 드라이버 종류가 있다는 사실을 알게 되었습니다.. 저는 기존의 Function Driver와 달리 Bus Driver이나 Filter Driver에서의 구조 차이와, 취약점이 어떤 방식으로 나타나는지 궁금했는데요.

오늘은 Minifilter Driver 구조와 동작 방식, 내부 구성요소와 취약점을 분석해보도록 하겠습니다!

![](./post01/image1.png)

# 1. About Minifilter Drivers

---

Minifilter 드라이버는 Windows에서 파일 생성, 열기, 읽기, 쓰기, 삭제와 같은 파일 시스템 I/O 요청을 모니터링하거나 가로채고 변경할 수 있도록 설계된 특수한 목적의 드라이버로, 파일 시스템 활동을 정밀하게 모니터링하는 데에 사용됩니다.

“파일 접근을 감시하고, 차단하거나 수정하는 것”을 생각해보면… 잠시만요. **Antivirus, EDR, 백업 프로그램**과 같이 가로채고 모니터링하는 것이 주 목적인 제품에 적합해 보이지 않나요? 맞습니다. 실제로 상당수의 해당 제품들이 Minifilter 드라이버를 사용하고 있는 것을 실제로 제가 확인할 수 있었는데요.

Minifiler 드라이버는 다음 세 가지 종류의 요청을 가로채거나 조작할 수 있습니다.

1. IRP (I/O Request Packet)
2. Fast I/O
3. File System Filter Callbacks

## 1.1 Filter Manager → Minifilter 흐름

Minifilter는 Windows의 Filter Manager(`fltmgr.sys`) 위에서 동작합니다. Filter Manager는 I/O Manager로부터 전달된 파일 I/O 요청을, 등록된 Minifilter 드라이버에게 Altitude 순서로 전달합니다. 즉, Altitude를 통해 로딩 순서를 제어할 수 있습니다.

![](./post01/image2.gif)

Windows에서 파일 I/O 요청이 처리되는 흐름을 확인해봅시다.

1. 애플리케이션이 `CreateFile`, `ReadFile`, `WriteFile`같은 API를 호출하는 I/O 작업을 요청합니다.
2. I/O Manager이 이 요청을 받아 Filter Manager(`fltmgr.sys`)로 전달합니다.
3. Filter Manager는 등록된 모든 Minifilter 드라이버 목록을 확인하고, Altitude 순서대로 각 드라이버에 요청을 전달합니다.
4. Minifilter이 작업을 수행한 뒤, 요청은 파일 시스템 Filter 드라이버로 전달됩니다.
5. 마지막으로 요청은 디스크 드라이버(Storage Driver Stack)에 전달되어 실제 디스크에 접근하거나 데이터를 처리하게 됩니다.

![](./post01/image3.png)

참고로 시스템에 로드된 Minifilter 목록은 cmd창의 fltmc 명령으로 확인할 수 있습니다. Altitude 값이 높을수록 우선순위가 높아져 I/O 요청을 먼저 가로채거나 조작할 수 있습니다. 단, 처리 순서는 사전 연산, 사후 연산에 따라 다릅니다.

- **사전 연산(Pre-operation)**: Altitude가 **높은 순서 → 낮은 순서**로 호출
- **사후 연산(Post-operation)**: Altitude가 **낮은 순서 → 높은 순서**로 호출

> 다시 돌아와 위 전체적인 흐름을 확인해보면… Minifilter 드라이버는 기존의 방식처럼 IRP를 직접 처리하지 않습니다. 대신, FilterManager가 I/O 요청을 대신 받아서 Minifilter에게 콜백 함수로 전달합니다.
> 
> 
> 다시말해 Minifilter 드라이버는 우리가 흔히 알고있는 **DispatchRoutine을 설정할 필요가 없는 것이죠!**
> 

## 1.2 Minifilter Callback Routine

Minifilter 드라이버는 어떻게 특정 파일 작업에 대해서만 동작할 수 있을까요? 이는 콜백(Callback)이라는 메커니즘 덕분입니다.

Minifilter 드라이버는 **DispatchRoutine**을 통해 IRP를 직접 처리하지 않는다고 했죠? 그 대신, Filter Manager를 통해 전달되는 I/O 요청에 “훅(hook)”을 걸 수 있습니다. Minifilter는 이 요청들이 발생할 때 사전 콜백(`PreOperation Callback`)과 사후 콜백(`PostOperation Callback`)을 등록하여, 감시하고자 하는 I/O 작업을 시스템 수준에서 관찰하거나 제어할 수 있습니다.

- **사전 작업 콜백 (`PFLT_PRE_OPERATION_CALLBACK`)**

```c
PFLT_PRE_OPERATION_CALLBACK PfltPreOperationCallback;

FLT_PREOP_CALLBACK_STATUS PfltPreOperationCallback(
  [in, out] PFLT_CALLBACK_DATA Data,
  [in]      PCFLT_RELATED_OBJECTS FltObjects,
  [out]     PVOID *CompletionContext
)
{...}
```

I/O 요청이 파일 시스템이나 하위 드라이버로 전달되기 이전에 호출됩니다. Minifilter의 핵심 로직이 수행되는 곳으로 `FLT_PREOP_COMPLETE`, `FLT_PREOP_SUCCESS_WITH_CALLBACK`, `FLT_PREOP_SUCCESS_NO_CALLBACK`과 같은 강력한 권한을 가지고 있습니다. 
[**PFLT_PRE_OPERATION_CALLBACK callback function (fltkernel.h)**](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nc-fltkernel-pflt_pre_operation_callback)

- **사후 작업 콜백 (`PFLT_POST_OPERATION_CALLBACK`)**

```c
PFLT_POST_OPERATION_CALLBACK PfltPostOperationCallback;

FLT_POSTOP_CALLBACK_STATUS PfltPostOperationCallback(
  [in, out]      PFLT_CALLBACK_DATA Data,
  [in]           PCFLT_RELATED_OBJECTS FltObjects,
  [in, optional] PVOID CompletionContext,
  [in]           FLT_POST_OPERATION_FLAGS Flags
)
{...}
```

I/O 요청이 하위 드라이버와 파일 시스템에서 처리를 모두 마치고 돌아오는 길에 호출됩니다. 작업의 성공 여부를 확인하거나, 결과를 로깅하거나, 필요하다면 작업 결과를 수정하는 등의 후처리 작업을 수행합니다.
[**PFLT_POST_OPERATION_CALLBACK callback function (fltkernel.h)**](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nc-fltkernel-pflt_post_operation_callback)

> 결과적으로, 이 콜백들은 `FLT_OPERATION_REGISTRATION`이라는 구조체에 “어떤 I/O 작업(MajorFunction)에 어떤 사전/사후 콜백 함수를 연결할지”를 명시해 등록합니다.
> 

## 1.3 Minifilter와 User-Mode 간의 통신

Minifilter 드라이버와 User-Mode 애플리케이션 간의 통신은 **필터 통신 포트**를 통해 이루어집니다. 통신 포트란, Minifilter와 앱 사이의 전용 고속 통신 채널입니다. 이 포트는 Kernel Mode 드라이버와 User-Mode 프로세스 간의 안전한 메시지 전달을 가능하게 합니다. 코드를 직접 확인해보며 Microsoft가 제공하는 여러 API를 확인해봅시다!

### Driver Code

```c
#include <fltKernel.h>

PFLT_FILTER gFilter = NULL;
PFLT_PORT gServerPort = NULL, gClientPort = NULL;

VOID OnDisconnect(PVOID Cookie) {
    UNREFERENCED_PARAMETER(Cookie);
    FltCloseClientPort(gFilter, &gClientPort);
    gClientPort = NULL;
}

NTSTATUS OnConnect(PFLT_PORT ClientPort, PVOID SrvCookie, PVOID Ctx, ULONG Size, PVOID* ConnCookie) {
    UNREFERENCED_PARAMETER(SrvCookie);
    UNREFERENCED_PARAMETER(Ctx);
    UNREFERENCED_PARAMETER(Size);
    UNREFERENCED_PARAMETER(ConnCookie);
    gClientPort = ClientPort;
    return STATUS_SUCCESS;
}

FLT_PREOP_CALLBACK_STATUS PreCreate(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS FltObjects, PVOID* Buff) {
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Buff);
    PFLT_FILE_NAME_INFORMATION nameInfo;

    if (gClientPort && NT_SUCCESS(FltGetFileNameInformation(Data, FLT_FILE_NAME_NORMALIZED, &nameInfo))) {
        FltSendMessage(gFilter, &gClientPort, nameInfo->Name.Buffer, nameInfo->Name.Length, NULL, NULL, NULL);
        FltReleaseFileNameInformation(nameInfo);
    }
    return FLT_PREOP_SUCCESS_NO_CALLBACK;
}

NTSTATUS Unload(FLT_FILTER_UNLOAD_FLAGS Flags) {
    UNREFERENCED_PARAMETER(Flags);
    FltCloseCommunicationPort(gServerPort);
    FltUnregisterFilter(gFilter);
    return STATUS_SUCCESS;
}

NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath) {
    UNREFERENCED_PARAMETER(RegistryPath);
    NTSTATUS status;

    const FLT_OPERATION_REGISTRATION Cbs[] = { { IRP_MJ_CREATE, 0, PreCreate, NULL }, { IRP_MJ_OPERATION_END } };
    const FLT_REGISTRATION Reg = { sizeof(FLT_REGISTRATION), FLT_REGISTRATION_VERSION, 0, NULL, Cbs, Unload };

    status = FltRegisterFilter(DriverObject, &Reg, &gFilter);
    if (!NT_SUCCESS(status)) return status;

    UNICODE_STRING portName = RTL_CONSTANT_STRING(L"\\FileActivityMonitorPort");
    OBJECT_ATTRIBUTES oa = { sizeof(oa), NULL, &portName, OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE, NULL };

    status = FltCreateCommunicationPort(gFilter, &gServerPort, &oa, NULL, OnConnect, OnDisconnect, NULL, 1);
    if (!NT_SUCCESS(status)) {
        FltUnregisterFilter(gFilter);
        return status;
    }

    return FltStartFiltering(gFilter);
}
```

대표적인 Driver Code API인 `FltCreateCommunicationPort()`, `FltSendMessage()`, `FltCloseCommunicationPort()`에 초점을 맞춰서 Minifilter 드라이버 코드를 예제로 구현해보았는데요. 흐름을 함께 살펴볼까요?

1. 드라이버는 `FltRegisterFilter()`를 통해 자신을 등록합니다. 이때 파일 생성과 열기(`IRP_MJ_CREATE`) 요청을 감시할 PreCreateCallback 함수를 지정하고, `FltStartFiltering()`으로 I/O 감시를 시작합니다.
2. `FltCreateCommunicationPort()` 함수를 통해 통신 포트를 생성할 수 있는데요, 위의 코드에서는 User-Mode 애플리케이션이 연결하고 알림을 받을 수 있는 통신 포트 `\\FileActivityMonitorPort`를 생성하고 있습니다.
3. 만약 파일 생성/열기 이벤트가 발생하면 PreCreateCallback이 호출되고, 해당 함수는 어떤 프로세스가 어떤 파일에 접근했는지 정보를 수집합니다.
4. 이후 `FltSendMessage()` 함수를 사용해 PreCreateCall에서 수집한 실시간 파일 접근 정보를 연결되어있는 User-Mode 애플리케이션으로 즉시 전송합니다.
5. 마지막으로 FilterUnload 언로드 함수를 통해 드라이버가 종료될 때, 열었던 통신 포트를 `FltCloseCommunicationPort()`로 닫고 필터 등록을 해제합니다.

### User-Mode Application Code

```c
#include <windows.h>
#include <fltuser.h>
#include <stdio.h>

#pragma comment(lib, "fltlib.lib")

int main() {
    HANDLE port;
    HRESULT hr;
    
    BYTE buffer[sizeof(FILTER_MESSAGE_HEADER) + 1024];
    PFILTER_MESSAGE_HEADER header = (PFILTER_MESSAGE_HEADER)buffer;

    printf("Connecting to driver...\n");

    hr = FilterConnectCommunicationPort(L"\\FileActivityMonitorPort", 0, NULL, 0, NULL, &port);
    if (IS_ERROR(hr)) {
        printf("Connection failed. Error 0x%X\n", hr);
        return 1;
    }

    printf("Connected. Waiting for file events...\n");

    while (TRUE) {
        hr = FilterGetMessage(port, header, sizeof(buffer), NULL);
        
        if (SUCCEEDED(hr)) {
            printf("File Accessed: %S\n", (PWSTR)header->MessageBody);
        } else {
            printf("Connection lost. Error 0x%X\n", hr);
            break;
        }
    }

    CloseHandle(port);
    return 0;
}
```

이제 User-Mode 애플리케이션의 통신 흐름을 확인해봅시다. 대표적인 API로 `FilterConnectCommunicationPort()`, `FilterSendMessage()`가 존재합니다.

1. 먼저 `FilterConnectCommunicationPort()` 함수를 사용해 커널에 있는 Minifilter 드라이버의 통신 포트인 `\\FileActivityMonitorPort`에 연결하고 통신을 위한 HANDLE을 얻습니다.
2. 그 후 `FilterGetMessage()` 함수를 호출하여, 드라이버로부터 파일 경로 문자열을 직접 수신합니다. 성공적으로 수신되면 해당 파일 경로를 화면에 출력합니다.

# 2. [CVE-2024-30085] 1-Day Analysis

---

하루한줄에도 소개되었던 Windows Minifilter Driver 취약점인데요([reference](https://hackyboiz.github.io/2025/01/11/OUYA77/2025-01-11/)). CVE-2024-30085를 직접 재현해보며 Minifilter 드라이버를 함께 알아가보도록 합시다.

> **🪟 Environment : Windows 11 22h2/23h2 10.0.2261.3672**
> 

![](./post01/image4.png)

Windows Cloud Files Mini Filter 드라이버는 Windows 클라우드 동기화 기능을 수행합니다. 예시로 지금 저의 폴더를 하나 찍어왔는데요, 오늘은 해당 Minifilter 드라이버 취약점을 이해하기 위해 먼저 Stub File, Reparse Point에 대한 사전 공부가 필요합니다.

### Stub File이란?

Stub File은 로컬에는 실제로 데이터가 없고, placeholder 형태로 존재하는 파일을 의미합니다. 위의 이미지를 확인해보면 ‘사진’ 폴더에 파란색 구름 아이콘이 status로 나타나있죠? 바로 해당 파일이 stub 상태라고 볼 수 있어요. NTFS 상에서 파일 크기, 이름, 아이콘 등은 표시하지만, 파일 내용은 전혀 저장되어 있지 않습니다.

### Reparse Point Metadata

그럼 사용자가 이러한 파일에 접근하면 어떻게 될까요!? NTFS는 Reparse Tag를 보고 **“오호… 이건 stub file이네!”**라고 판단합니다. 이때 Windows Cloud Files Minifilter(`cldflt.sys`)가 이 `Reparse Point` 메타데이터 구조체를 읽고, 이 파일을 어떻게 처리할지 결정하는 것이죠.

이후 Minifilter은 원격 서버와 통신을 준비하는데, `cldflt.sys`는 직접 서버와 통신하지 않습니다. User-Mode 프로세스에 실제 작업을 위임해버리는데요. 위에서 보았던 Minifilter이 I/O Interpreter 역할을 수행하고, 실제 데이터 조작은 User-Mode 클라이언트가 담당한다는 개념과 일치하죠? (오.. 신기하네요.)

Windows Cloud Files Minifilter의 Reparse Point 구조체를 Local Types에 추가했는데요, 제가 정의한 CldFlt 구조체 세트를 함께 확인해봅시다.

```c
typedef struct _REPARSE_DATA_BUFFER {
    DWORD ReparseTag;
    WORD ReparseDataLength;
    WORD Reserved;
    WORD Flags;
    WORD UncompressedSize;
    REPARSE_CLD_BUFFER ReparseCldBuffer;
} REPARSE_DATA_BUFFER, *PREPARSE_DATA_BUFFER;
```

먼저 `REPARSE_DATA_BUFFER`는 NTFS의 모든 Reparse Point 데이터를 표현하는 표준 헤더 구조체이지만, 여기서 사용할 구조체는 Cloud Files를 쉽게 분석하기 위해 재정의한 버전입니다. 이 구조체는 `ReparseTag`로 소유 드라이버를 식별하고 `ReparseDataLength`, `Flags` 같은 최상위 메타정보를 담으며, 실제 데이터는 `HSM_REPARSE`로 이어지는 것을 확인할 수 있습니다.

```c
struct HSM_REPARSE
{
    USHORT hsmFlags;
    USHORT hsmSize;
    struct HSM_RP_DATA fileData;
};
```

`HSM_REPARSE`는 Cloud Files 전용 Reparse Point 전체 컨테이너입니다. `hsmFlags`와 `hsmSize`로 압축 여부와 HSM 블록 전체 크기를 나타내고, `fileData` 필드에 `HSM_RP_DATA` 구조체를 포함하고 있습니다.

```c
struct HSM_RP_DATA 
{       
    ULONG magic;
    ULONG crc32;
    ULONG totalSize;
    USHORT dataFlags;
    USHORT elemCount;
    struct HSM_RP_ELEMENT elements[5];
};
```

이어서 `HSM_RP_DATA` 구조체는 메인 헤더로, 전체 메타데이터 블록의 구조와 위치를 담고 있습니다. magic을 통해 데이터 종류를 식별하고, crc32를 통해 `dataFlags`에 CRC 존재 비트가 설정되면 `RtlComputeCrc32`로 검증합니다. elements[] 배열에는 `HSM_RP_ELEMENT` 구조체들이 저장되어 각 메타데이터 요소의 유형, 크기, 오프셋을 정의합니다.

```c
struct HSM_RP_ELEMENT 
{               
    USHORT elemType;
    USHORT elemSize;
    ULONG elemOffset;
};

typedef enum HSM_RP_ELEM_TYPE {
    HSM_RP_ELEMENT_NONE   = 0x00,
    HSM_RP_ELEMENT_U64    = 0x06,
    HSM_RP_ELEMENT_BYTE   = 0x07,
    HSM_RP_ELEMENT_U32    = 0x0a,
    HSM_RP_ELEMENT_BITMAP = 0x11,
    HSM_RP_ELEMENT_MAX    = 0x12
} HSM_RP_ELEMENT_TYPE;
```

이후 `HSM_RP_ELEMENT`에서는 개별 메타데이터 요소의 type, size, offset을 정의하며, `HSM_RP_ELEMENT_TYPE` 값으로 유형을 구분하는 양상을 확인할 수 있습니다.

## 2.1 Root Cause Analysis

![](./post01/image5.png)

취약점은 파일을 생성해 `HsmFltPostCREATE` 콜백이 실행되어 해당 파일의 Reparse Point를 처리할 때,  `HsmFltPostCREATE` 내부에서 Reparse Point에 담긴 bitmap 정보를 처리하기 위해 호출되는 `HsmIBitmapNORMALOpen()` 함수에서 발생합니다.

- `bitmap_size`는 User-Mode 요청 버퍼에서 읽어온 값입니다.
- 크기 0x1000으로 고정 할당한 버퍼 `ExAllocatePoolWithTag`에 대해, 사용자가 제어 가능한 `bitmap_size`를 경계 검사 없이 그대로 `memmove`에 전달하여 복사하고 있습니다.

따라서 만약 `bitmap_size` > 0x1000인 경우, Heap-based Buffer Overflow가 발생하게 될 것으로 예상해볼 수 있습니다!

![](./post01/image6.png)

`HsmpBitmapIsReparseBufferSupported()` 함수를 확인해보면 `hdr->elements[4].elemSize` 값이 0x1000보다 크면 오류를 반환하는데요. 

![](./post01/image7.png)

조금 더 위로 올라가서 조건문 코드를 확인해보면 `hdr->elements[2]`를 엄격하게 검증하고 있는 것을 확인할 수 있습니다. `total ≥ 0x18`, `hdr→elemCount` 등의 경계 체크를 모두 통과해야 진행이 되는군요.. 이 조건을 충족하지 못하면 fail을 반환하겠죠?

![](./post01/image8.png)

그런데 동일 함수에 `hasBuf`가 false로 설정되어 있으면, 별도의 비트맵 길이 검사를 수행하지 않고 `element[1]`의 1바이트 플래그만 확인해도 result = 0으로 success를 반환하는 코드가 있습니다. 이 경로에서는 비트맵의 길이가 0x1000보다 큰지 검사가 수행되지 않기 때문에, 검증이 건너뛰어지면서 데이터가 유효한 것으로 처리되어 버립니다.

## 2.2 Exploit

![](./post01/image9.png)

cldflt.sys 미니필터 드라이버는 기본적으로 모든 파일 시스템 I/O를 훑는게 아니라, CfAPI를 통한 Sync Root 경로에 대해서만 동작합니다. 따라서 먼저 `CfRegisterSyncRoot()` 함수를 통해 클라우드 동기화 폴더의 Root 디렉터리에 도달해보았습니다!

![](./post01/image10.png)

Sync Root를 등록하는 코드를 우선 빌드하고 실행해보면 이런 폴더가 생기는데요. 이 폴더 내부에는 클라우드 Stub File, 메타데이터가 생길 수 있고, 제가 이걸 악용할 수 있는 지점이 됩니다.

```c
-> HsmFltPostCREATE()
-> HsmiFltPostECPCREATE()
-> HsmpSetupContexts()
-> HsmpCtxCreateStreamContext()
-> HsmIBitmapNORMALOpen()
```

동적 분석을 통해 확인해본 결과, 취약한 함수인 `HsmIBitmapNORMALOpen()` 함수로 진입하려면 위와 같은 함수 체인을 순차적으로 통과하면서 조건문을 모두 충족해야 진입할 수 있음을 알게 되었습니다. 이제 저의 목표는 조건을 모두 충족해서 `HsmIBitmapNORMALOpen()` 함수의 취약한 `memmove`에 도달하는 것입니다. 

> **Minifilter Driver로서의 흐름 이해**
> 

앞서 Minifilter 드라이버는 I/O 요청이 발생했을 때 IRP 코드별로 Callback을 호출한다고 했죠? 취약점 경로에 진입하기 위해 `IRP_MJ_CREATE`의 `Post-Create Callback`(`HsmFltPostCREATE`)를 시작으로 순차적으로 함수에 도달해야 합니다. 이 중간 함수들은 파일/스트림 속성과 Reparse Point 정보를 기반으로 진입 조건을 검증하므로, 저희는 이를 우회하는 특수한 파일 구조를 만들면 되는 겁니다!

1. `MakeDataBuffer()`로 `IO_REPARSE_TAG_CLOUD` 구조 생성 → Minifilter가 해당 파일을 Cloud Stub File로 인식해 Reparse Point 파싱 로직 진입.
2. Item Tag = `0x11`(Bitmap) → `Size`를 `0x1000 + overSize`로 설정해 `memmove()`에서 할당 크기를 초과한 복사(Heap Overflow) 유발. 다른 요소들(Tag `0x7`, `0x6`, `0xA` 등)도 Minifilter의 경계 체크를 통과하도록 값 설정.
3. Overflow 데이터에 Fake 커널 객체 포인터 포함 → `FSCTL_SET_REPARSE_POINT`로 적용 후 `CreateFile()` 호출 시 `HsmIBitmapNORMALOpen()` 진입

![](./post01/image11.png)

조건을 충족하면 FltMgr로부터 시작해 `HsmIBitmapNORMALOpen()`에 진입하는 것을 확인할 수 있습니다!

Exploit 과정을 전부 담고싶지만 오늘은 Minifilter 설명 글이고 벌써 분량 조절에 실패해버린 것 같으니.. 전체 exploit 시나리오를 한번 요약해보겠습니다.

![](./post01/image12.png)

> **Proof of Concept Overview**
> 

1. **EPROCESS 구조 분석 및 Token 필드 Offset 계산**
EPROCESS 구조체에서 Token 필드의 오프셋을 계산해 이후 SYSTEM Token swap 준비.
2. **첫 번째 `WNF_STATE_DATA` Spray 및 Hole 생성**
0x1000 크기(0xff0 데이터)의 `WNF_STATE_DATA` 오브젝트를 대량으로 생성(spray)하고, 해제해 커널 힙에 Heap Hole 생성.
3. **취약한 비트맵 파일 오픈 및 첫 번째 Overflow 트리거**
`CfRegisterSyncRoot()`와 Reparse Point 디렉터리 조작을 통해 Sync Root 내부의 취약한 비트맵 파일을 준비. 이후 `CreateFile()`로 파일을 열어 `IRP_MJ_CREATE()` → `HsmFltPostCREATE()` → `HsmiFltPostECPCREATE()` → `HsmpSetupContexts()` → `HsmpCtxCreateStreamContext()` → `HsmIBitmapNORMALOpen()` 경로까지 진입하고, Heap Overflow를 통해 인접한 `WNF_STATE_DATA`의 DataSize를 변조해 OOB R/W를 확보.
4. **커널 포인터 Leak**
변조된 `WNF_STATE_DATA`를 이용해 `_KALPC_RESERVE` **포인터를 읽어 커널 주소 Leak.
5. **두 번째 `WNF_STATE_DATA` Spray 및 Hole 생성**
다시 동일 크기의 `WNF_STATE_DATA`를 Spray하고 해제해 Hole을 만든 후, 이번에는 `PipeAttribute` 구조와 인접한 영역에 WNF 객체가 배치되도록 구성.
6. **두 번째 Overflow를 통해 `PipeAttribute` 조작**
두 번째 비트맵 파일을 열어 Heap Overflow를 발생시키고, 인접한 `PipeAttribute`의 `Flink` 포인터를 사용자 공간 Fake `PipeAttribute` 구조체 주소로 덮음.
7. **Arbitrary Read 구성 및 EPROCESS/Token 주소 획득**
Fake `PipeAttribute`를 이용해 ALPC Port 구조체에 접근하고, 이를 통해 대상 프로세스의 EPROCESS 주소와 Token 주소를 순차적으로 read.
8. **Token Swapping 및 SYSTEM 권한 획득**
Arbitrary Write를 통해 현재 프로세스의 Token 값을 SYSTEM Token 값으로 교체하고, SYSTEM 권한의 `cmd.exe`를 실행.

### ALPC/WNF

`_WNF_STATE_DATA`와 `_ALPC_HANDLE_TABLE` 구조체를 이용해 Heap Hole을 위한 Arbitrary size 커널 객체를 할당하고, 커널 메모리 주소를 leak하게 되는데요. 아마도 ALPC와 WNF 개념이 생소하실 겁니다. exploit을 하기 위해 두 sub system을 설명해보면 다음과 같습니다.

> **ALPC (Asynchronous Local Procedure Call)**
> 

![](./post01/image13.webp)

ALPC는 Windows 커널 내부의 IPC 메커니즘으로, 클라이언트와 서버 포트를 생성해 메시지를 주고받는 구조를 가지고 있습니다. 이때 ALPC의 HANDLE TABLE의 `_ALPC_HANDLE_ENTRY`를 이용하면 메시지 버퍼 주소를 저장할 수 있는데, 이 TABLE의 크기는 가변적이기 때문에 Arbitrary 크기의 커널 객체를 생성할 수 있게 됩니다!

- ALPC 포트 생성 시 `_ALPC_HANDLE_TABLE`이 **paged pool**에 0x80 크기로 할당됨
- `NtAlpcCreateResourceReserve` 호출 시마다 `_KALPC_RESERVE` 객체가 생성되고 이 주소가 HANDLE TABLE에 추가됨
- 이 구조를 변조하면 임의 커널 주소 Read/Write primitive 가능
    
    → PoC에서는 fake `_KALPC_RESERVE`를 주입해 arbitrary R/W 달성
    
- ALPC HANDLE은 User-Mode에서도 제어 가능 → exploit에 용이해짐

> **WNF (Windows Notification Facility)**
> 

![](./post01/image14.webp)

WNF는 Windows의 알림 시스템인데요. WNF_NAME_INSTANCE 커널 객체는 내부에 _WNF_STATE_DATA라는 필드를 가지는데 이 크기는 가변적이기 때문에 User-Mode에서 `NtCreateWnfStateName` + `NtUpdateWnfStateData`로 직접 커널 객체 크기 제어 가능할 수 있게 됩니다.

- `_WNF_STATE_DATA`는 0x1000 크기로 할당 가능 (0x10 header + 0xFF0 data)
- heap spraying 용도로 WNF 객체를 다량 생성해, 목표 구조체(ALPC 객체)와 인접하게 배치
- PoC에서는 WNF를 이용해 heap hole을 만들고 ALPC 객체 인접에 배치하여 ALPC HANDLE TABLE에 Overflow 유도

특히 PoC에서는 Pipe를 생성하는 루틴을 등록해야 했는데, 저는 이 부분이 흥미로웠습니다.

```c
struct PipeAttribute { 
    LIST_ENTRY list; 
    char * AttributeName; 
    uint64_t AttributeValueSize; 
    char * AttributeValue; 
    char data[0];
}
```

Pipe는 변조된 `PipeAttribute` 구조체의 Value 포인터를 커널 메모리 주소로 세팅해 커널이 해당 주소를 참조해 읽은 데이터를 User-Mode 공간에 반환해줄 수 있게 해주는데요. 이로써 ALPC로 확보한 메모리 레이아웃과 WNF Overflow 조합을 이용해 Pipe를 Arbitrary Read primitive로 전환해 커널 주소를 leak할 수 있게 됩니다!

## 3. 마무리

---

![](./post01/image15.gif)

마무리는 제가 `cldflt.sys`의 Minifilter 드라이버 특성, 그리고 WNF + ALPC 기법을 통해 구현한 LPE 결과를 보여드리며 끝내도록 하겠습니다.