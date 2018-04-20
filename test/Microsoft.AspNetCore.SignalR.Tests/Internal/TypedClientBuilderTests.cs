using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR.Internal;
using Moq;
using Xunit;

namespace Microsoft.AspNetCore.SignalR.Tests.Internal
{
    public class TypedClientBuilderTests
    {
        [Fact]
        public async Task ProducesImplementationThatProxiesMethodsToIClientProxyAsync()
        {
            var clientProxy = new MockProxy();
            var typedProxy = TypedClientBuilder<ITestClient>.Build(clientProxy);

            var objArg = new object();
            var task = typedProxy.Method("foo", 42, objArg);
            Assert.False(task.IsCompleted);

            Assert.Collection(clientProxy.Sends,
                send =>
                {
                    Assert.Equal("Method", send.Method);
                    Assert.Equal("foo", send.Arguments[0]);
                    Assert.Equal(42, send.Arguments[1]);
                    Assert.Same(objArg, send.Arguments[2]);
                    send.Complete();
                });

            await task.OrTimeout();
        }

        [Fact]
        public async Task SupportsSubInterfaces()
        {
            var clientProxy = new MockProxy();
            var typedProxy = TypedClientBuilder<IInheritedClient>.Build(clientProxy);

            var objArg = new object();
            var task1 = typedProxy.Method("foo", 42, objArg);
            Assert.False(task1.IsCompleted);

            var task2 = typedProxy.SubMethod("bar");
            Assert.False(task2.IsCompleted);

            Assert.Collection(clientProxy.Sends,
                send1 =>
                {
                    Assert.Equal("Method", send1.Method);
                    Assert.Collection(send1.Arguments,
                        arg1 => Assert.Equal("foo", arg1),
                        arg2 => Assert.Equal(42, arg2),
                        arg3 => Assert.Same(objArg, arg3));
                    send1.Complete();
                },
                send2 =>
                {
                    Assert.Equal("SubMethod", send2.Method);
                    Assert.Collection(send2.Arguments,
                        arg1 => Assert.Equal("bar", arg1));
                    send2.Complete();
                });

            await task1.OrTimeout();
            await task2.OrTimeout();
        }

        [Fact]
        public void ThrowsIfProvidedAClass()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<object>.Build(clientProxy));
            Assert.Equal("Type must be an interface.", ex.Message);
        }

        [Fact]
        public void ThrowsIfProvidedAStruct()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<ValueTask>.Build(clientProxy));
            Assert.Equal("Type must be an interface.", ex.Message);
        }

        [Fact]
        public void ThrowsIfProvidedADelegate()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<EventHandler>.Build(clientProxy));
            Assert.Equal("Type must be an interface.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceHasVoidReturningMethod()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IVoidMethodClient>.Build(clientProxy));
            Assert.Equal($"Cannot generate proxy implementation for '{typeof(IVoidMethodClient).FullName}.{nameof(IVoidMethodClient.Method)}'. All client proxy methods must return '{typeof(Task).FullName}'.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceHasNonTaskReturns()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IStringMethodClient>.Build(clientProxy));
            Assert.Equal($"Cannot generate proxy implementation for '{typeof(IStringMethodClient).FullName}.{nameof(IStringMethodClient.Method)}'. All client proxy methods must return '{typeof(Task).FullName}'.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceMethodHasOutParam()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IOutParamMethodClient>.Build(clientProxy));
            Assert.Equal(
                $"Cannot generate proxy implementation for '{typeof(IOutParamMethodClient).FullName}.{nameof(IOutParamMethodClient.Method)}'. Client proxy methods must not have 'out' parameters.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceMethodHasRefParam()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IRefParamMethodClient>.Build(clientProxy));
            Assert.Equal(
                $"Cannot generate proxy implementation for '{typeof(IRefParamMethodClient).FullName}.{nameof(IRefParamMethodClient.Method)}'. Client proxy methods must not have 'ref' parameters.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceHasProperties()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IPropertiesClient>.Build(clientProxy));
            Assert.Equal("Type must not contain properties.", ex.Message);
        }

        [Fact]
        public void ThrowsIfInterfaceHasEvents()
        {
            var clientProxy = new MockProxy();
            var ex = Assert.Throws<InvalidOperationException>(() => TypedClientBuilder<IEventsClient>.Build(clientProxy));
            Assert.Equal("Type must not contain events.", ex.Message);
        }

        public interface ITestClient
        {
            Task Method(string arg1, int arg2, object arg3);
        }

        public interface IVoidMethodClient
        {
            void Method(string arg1, int arg2, object arg3);
        }

        public interface IStringMethodClient
        {
            string Method(string arg1, int arg2, object arg3);
        }

        public interface IOutParamMethodClient
        {
            Task Method(out string arg1);
        }

        public interface IRefParamMethodClient
        {
            Task Method(ref string arg1);
        }

        public interface IInheritedClient : ITestClient
        {
            Task SubMethod(string foo);
        }

        public interface IPropertiesClient
        {
            string Property { get; }
        }

        public interface IEventsClient
        {
            event EventHandler Event;
        }

        private class MockProxy : IClientProxy
        {
            public IList<SendContext> Sends { get; } = new List<SendContext>();

            public Task SendCoreAsync(string method, object[] args)
            {
                var tcs = new TaskCompletionSource<object>();

                Sends.Add(new SendContext(method, args, tcs));

                return tcs.Task;
            }
        }

        private struct SendContext
        {
            private TaskCompletionSource<object> _tcs;

            public string Method { get; }
            public object[] Arguments { get; }

            public SendContext(string method, object[] arguments, TaskCompletionSource<object> tcs) : this()
            {
                Method = method;
                Arguments = arguments;
                _tcs = tcs;
            }

            public void Complete()
            {
                _tcs.TrySetResult(null);
            }
        }
    }
}
